import { Context } from "hono";
import { z } from "zod";
import {
    findUserById,
    findUserByUsername,
    generateAffCode,
    hashPassword,
    ROLE_ROOT,
    ROLE_USER,
    STATUS_ENABLED,
    type UserRow,
} from "../user/auth";
import { dollarsToRaw, rawToDollars } from "../billing";

// ---------------------------------------------------------------------------
// 用户管理 API (one-api 移植, 保持 chanfana 端点风格)
// ---------------------------------------------------------------------------

const userListInput = z.object({
    page: z.number().int().default(1),
    keyword: z.string().optional(),
});

export const UserListEndpoint = {
    summary: "List users",
    request: {
        query: userListInput,
    },
    handler: async (c: Context<HonoCustomType>) => {
        const keyword = c.req.query("keyword")?.trim();
        let sql = "SELECT id, username, email, display_name, role, status, quota, used_quota, user_group, inviter_id, aff_code, created_at FROM users";
        const params: unknown[] = [];
        if (keyword) {
            sql += " WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ?";
            const like = `%${keyword}%`;
            params.push(like, like, like);
        }
        sql += " ORDER BY id ASC";
        const now = await c.env.DB.prepare(sql).bind(...params).all();
        const users = (now.results || []).map((row: any) => {
            const quotaRaw = Number(row.quota);
            const usedRaw = Number(row.used_quota || 0);
            // -1 = 无限额度, 对外返回 -1; 否则 raw 转美元
            const quota = quotaRaw === -1 ? -1 : rawToDollars(quotaRaw);
            const used_quota = quotaRaw === -1 ? rawToDollars(usedRaw) : rawToDollars(usedRaw);
            return {
                ...row,
                quota,
                used_quota,
                balance: quotaRaw === -1 ? -1 : Math.max(0, rawToDollars(quotaRaw - usedRaw)),
            };
        });
        return c.json({ success: true, data: { users } });
    },
};

const userCreateInput = z.object({
    username: z.string().min(3).max(20),
    password: z.string().min(6).max(64),
    email: z.string().email().max(100).optional().default(""),
    display_name: z.string().max(30).optional().default(""),
    quota: z.number().nonnegative().optional().default(0),
});

export const UserCreateEndpoint = {
    summary: "Create user",
    request: {
        body: userCreateInput,
    },
    handler: async (c: Context<HonoCustomType>) => {
        const body = await c.req.json();
        const parsed = userCreateInput.safeParse(body);
        if (!parsed.success) {
            return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
        }
        const { username, password, display_name, email, quota } = parsed.data;

        const existing = await findUserByUsername(c, username);
        if (existing) {
            return c.json({ success: false, error: "Username already exists" }, 409);
        }

        const { hash, salt } = await hashPassword(password);
        const storedHash = `${salt}:${hash}`;
        const affCode = generateAffCode();
        // quota 为美元输入, 存库转为 raw 内部单位
        const quotaRaw = dollarsToRaw(quota);
        const result = await c.env.DB.prepare(
            `INSERT INTO users (username, password_hash, display_name, email, role, status, quota, used_quota, aff_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
        ).bind(username, storedHash, display_name, email, ROLE_USER, STATUS_ENABLED, quotaRaw, affCode).run();

        return c.json({ success: true, data: { changes: result.meta?.changes } });
    },
};

const userUpdateInput = z.object({
    display_name: z.string().max(30).optional(),
    email: z.string().email().max(100).optional(),
    role: z.number().int().optional(),
    status: z.number().int().optional(),
    quota: z.number().nonnegative().optional(),
    password: z.string().min(6).max(64).optional(),
});

export const UserUpdateEndpoint = {
    summary: "Update user",
    request: {
        body: userUpdateInput,
    },
    handler: async (c: Context<HonoCustomType>) => {
        const id = Number(c.req.param("id"));
        const target = await findUserById(c, id);
        if (!target) {
            return c.json({ success: false, error: "User not found" }, 404);
        }

        const body = await c.req.json();
        const parsed = userUpdateInput.safeParse(body);
        if (!parsed.success) {
            return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
        }
        const data = parsed.data;

        // 保护根账号
        if (target.role === ROLE_ROOT && data.role !== undefined && (data.role as number) < ROLE_ROOT) {
            return c.json({ success: false, error: "Cannot demote root user" }, 403);
        }

        const sets: string[] = [];
        const params: unknown[] = [];
        if (data.display_name !== undefined) { sets.push("display_name = ?"); params.push(data.display_name); }
        if (data.email !== undefined) { sets.push("email = ?"); params.push(data.email); }
        if (data.role !== undefined) { sets.push("role = ?"); params.push(data.role); }
        if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
        if (data.quota !== undefined) { sets.push("quota = ?"); params.push(dollarsToRaw(data.quota)); }
        if (data.password !== undefined) {
            const { hash, salt } = await hashPassword(data.password);
            sets.push("password_hash = ?"); params.push(`${salt}:${hash}`);
        }
        if (sets.length === 0) {
            return c.json({ success: false, error: "Nothing to update" }, 400);
        }
        sets.push("updated_at = datetime('now')");
        params.push(id);

        const result = await c.env.DB.prepare(
            `UPDATE users SET ${sets.join(", ")} WHERE id = ?`
        ).bind(...params).run();

        return c.json({ success: true, data: { changes: result.meta?.changes } });
    },
};

export const UserDeleteEndpoint = {
    summary: "Delete user",
    handler: async (c: Context<HonoCustomType>) => {
        const id = Number(c.req.param("id"));
        const target = await findUserById(c, id);
        if (!target) {
            return c.json({ success: false, error: "User not found" }, 404);
        }
        if (target.role === ROLE_ROOT) {
            return c.json({ success: false, error: "Cannot delete root user" }, 403);
        }
        const result = await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
        return c.json({ success: true, data: { changes: result.meta?.changes } });
    },
};

// 批量用户管理操作 (移植自 one-api ManageUser)
// action: disable | enable | promote | demote
export const UserManageEndpoint = {
    summary: "Manage user (disable/enable/promote/demote)",
    handler: async (c: Context<HonoCustomType>) => {
        const body = await c.req.json().catch(() => ({}));
        const id = Number(body.user_id ?? body.id);
        const action = String(body.action || "");
        if (!Number.isInteger(id) || id <= 0) {
            return c.json({ success: false, error: "user_id is required" }, 400);
        }
        if (!["disable", "enable", "promote", "demote"].includes(action)) {
            return c.json({ success: false, error: "Invalid action" }, 400);
        }

        const target = await findUserById(c, id);
        if (!target) {
            return c.json({ success: false, error: "User not found" }, 404);
        }

        // 权限保护: 不能操作 root 用户
        if (target.role === ROLE_ROOT && action !== "enable") {
            return c.json({ success: false, error: "Cannot manage root user" }, 403);
        }

        let sets: string[] = [];
        switch (action) {
            case "disable":
                sets.push("status = 2");
                break;
            case "enable":
                sets.push("status = 1");
                break;
            case "promote":
                sets.push("role = 10");
                break;
            case "demote":
                if (target.role === ROLE_ROOT) {
                    return c.json({ success: false, error: "Cannot demote root user" }, 403);
                }
                sets.push("role = 1");
                break;
        }
        sets.push("updated_at = datetime('now')");

        const result = await c.env.DB.prepare(
            `UPDATE users SET ${sets.join(", ")} WHERE id = ?`
        ).bind(id).run();

        const updated = await findUserById(c, id);
        return c.json({
            success: true,
            data: {
                changes: result.meta?.changes,
                user: updated
                    ? {
                        id: updated.id,
                        username: updated.username,
                        role: updated.role,
                        status: updated.status,
                    }
                    : null,
            },
        });
    },
};

// ---------- 用户自助 (登录后可用) ----------

export const UserSelfEndpoint = {
    summary: "Get current user info",
    handler: async (c: Context<HonoCustomType>) => {
        const user = (c as any).user as UserRow;
        if (!user) {
            return c.json({ success: false, error: "Unauthorized" }, 401);
        }
        return c.json({
            success: true,
            data: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                role: user.role,
                status: user.status,
                quota: user.quota,
                used_quota: user.used_quota,
                balance: user.quota === -1 ? -1 : Math.max(0, user.quota - user.used_quota),
            },
        });
    },
};