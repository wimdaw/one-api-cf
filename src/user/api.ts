import { Context } from "hono";
import { findUserById, type UserRow } from "./auth";
import {
    getAdminSessionTokenFromRequest,
    validateAdminSession,
} from "../admin/auth_shared";

// 用户自助认证中间件: 读取用户会话 cookie, 加载当前用户到 c.set("user")
export async function requireUser(c: Context<HonoCustomType>, next: () => Promise<void>) {
    const sessionToken = getAdminSessionTokenFromRequest(c);
    if (!sessionToken) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = await validateAdminSession(c, sessionToken);
    if (!userId || userId <= 0) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const user = await findUserById(c, userId);
    if (!user || user.status !== 1) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    c.set("user", user);
    await next();
}

export function getCurrentUser(c: Context<HonoCustomType>): UserRow | null {
    return c.get("user") || null;
}