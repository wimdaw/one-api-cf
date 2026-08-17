import { Context } from "hono";
import { z } from "zod";
import {
    findUserByUsername,
    generateAffCode,
    getInviteQuotas,
    hashPassword,
    isEnabled,
    ROLE_USER,
    STATUS_ENABLED,
    verifyPassword,
    type UserRow,
} from "../user/auth";
import {
    createAdminSession,
    setAdminSessionCookie,
    clearAdminSessionCookie,
} from "./auth_shared";
import { getSystemConfig } from "../system-config";

// 用户注册/登录 API (one-api 移植, 保持现有风格)

const registerSchema = z.object({
    username: z.string().trim().min(3).max(20),
    password: z.string().min(6).max(64),
    display_name: z.string().trim().max(30).optional().default(""),
    inviter_code: z.string().trim().optional(),
});

export const UserRegisterEndpoint = {
    summary: "Register a new user",
    handler: async (c: Context<HonoCustomType>) => {
        const parsed = registerSchema.safeParse(await c.req.json());
        if (!parsed.success) {
            return c.json({ success: false, error: parsed.error.issues[0]?.message }, 400);
        }
        const { username, password, display_name, inviter_code } = parsed.data;

        // 后台开关: 关闭注册时拒绝前台注册 (管理员仍可手动建号)
        const systemConfig = await getSystemConfig(c);
        if (!systemConfig.website.allowRegister) {
            return c.json({ success: false, error: "Registration is disabled" }, 403);
        }

        const existing = await findUserByUsername(c, username);
        if (existing) {
            return c.json({ success: false, error: "Username already exists" }, 409);
        }

        // 邀请码: 根据邀请码找到邀请者
        let inviterId: number | null = null;
        if (inviter_code) {
            const inviter = await c.env.DB.prepare(
                "SELECT id FROM users WHERE aff_code = ?"
            ).bind(inviter_code.trim().toUpperCase()).first<{ id: number }>();
            if (inviter) {
                inviterId = inviter.id;
            }
        }

        const { hash, salt } = await hashPassword(password);
        const storedHash = `${salt}:${hash}`;
        const affCode = generateAffCode();

        // 注册返利额度
        const { quotaForInvitee, quotaForInviter } = await getInviteQuotas(c);
        const inviteeQuota = inviterId ? quotaForInvitee : 0;

        const result = await c.env.DB.prepare(
            `INSERT INTO users (username, password_hash, display_name, role, status, quota, used_quota, inviter_id, aff_code)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).bind(username, storedHash, display_name, ROLE_USER, STATUS_ENABLED, inviteeQuota, inviterId, affCode).run();

        // 邀请者返利
        if (inviterId && quotaForInviter > 0) {
            await c.env.DB.prepare(
                `UPDATE users
                 SET quota = CASE WHEN quota = -1 THEN -1 ELSE quota + ? END,
                     updated_at = datetime('now')
                 WHERE id = ?`
            ).bind(quotaForInviter, inviterId).run();
        }

        return c.json({
            success: true,
            data: {
                changes: result.meta?.changes,
                aff_code: affCode,
                inviter_id: inviterId,
                quota: inviteeQuota,
            },
        });
    },
};

const loginSchema = z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
});

export const UserLoginEndpoint = {
    summary: "Login a user",
    handler: async (c: Context<HonoCustomType>) => {
        const parsed = loginSchema.safeParse(await c.req.json());
        if (!parsed.success) {
            return c.json({ success: false, error: "Invalid username or password" }, 400);
        }
        const { username, password } = parsed.data;

        const user = await findUserByUsername(c, username);
        if (!user) {
            return c.json({ success: false, error: "Invalid username or password" }, 401);
        }
        if (!isEnabled(user)) {
            return c.json({ success: false, error: "Account disabled" }, 403);
        }

        const [salt, storedHash] = (user.password_hash || "").split(":");
        if (!salt || !storedHash || !(await verifyPassword(password, storedHash, salt))) {
            return c.json({ success: false, error: "Invalid username or password" }, 401);
        }

        const session = await createAdminSession(c, false, user.id);
        setAdminSessionCookie(c, session.sessionToken, session.expiresAt, session.ttlMs);

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
                balance: Math.max(0, user.quota - user.used_quota),
            },
        });
    },
};

export const UserLogoutEndpoint = {
    summary: "Logout / clear session cookie",
    handler: async (c: Context<HonoCustomType>) => {
        clearAdminSessionCookie(c);
        return c.json({ success: true, data: {} });
    },
};