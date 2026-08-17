import { Context } from "hono";
import { z } from "zod";
import {
    findUserByUsername,
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

// 用户注册/登录 API (one-api 移植, 保持现有风格)

const registerSchema = z.object({
    username: z.string().trim().min(3).max(20),
    password: z.string().min(6).max(64),
    display_name: z.string().trim().max(30).optional().default(""),
    inviter_id: z.number().int().optional(),
});

export const UserRegisterEndpoint = {
    summary: "Register a new user",
    handler: async (c: Context<HonoCustomType>) => {
        const parsed = registerSchema.safeParse(await c.req.json());
        if (!parsed.success) {
            return c.json({ success: false, error: parsed.error.issues[0]?.message }, 400);
        }
        const { username, password, display_name, inviter_id } = parsed.data;

        const existing = await findUserByUsername(c, username);
        if (existing) {
            return c.json({ success: false, error: "Username already exists" }, 409);
        }

        const { hash, salt } = await hashPassword(password);
        const storedHash = `${salt}:${hash}`;
        const result = await c.env.DB.prepare(
            `INSERT INTO users (username, password_hash, display_name, role, status, quota, used_quota, inviter_id)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
        ).bind(username, storedHash, display_name, ROLE_USER, STATUS_ENABLED, inviter_id ?? null).run();

        return c.json({ success: true, data: { changes: result.meta?.changes } });
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