import { Context } from "hono";
import { getCurrentUser, requireUser } from "./api";
import { MyTokenListEndpoint, MyTokenCreateEndpoint } from "./token_api";

// 删除我的令牌
async function deleteMyToken(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const key = c.req.param("key");
    const row = await c.env.DB.prepare(
        "SELECT value FROM api_token WHERE key = ?"
    ).bind(key).first<{ value: string }>();
    if (!row) {
        return c.json({ success: false, error: "Token not found" }, 404);
    }
    try {
        const data = JSON.parse(row.value) as ApiTokenData;
        if (data.user_id !== user.id) {
            return c.json({ success: false, error: "Not your token" }, 403);
        }
    } catch {
        return c.json({ success: false, error: "Not your token" }, 403);
    }
    await c.env.DB.prepare("DELETE FROM api_token WHERE key = ?").bind(key).run();
    return c.json({ success: true, data: {} });
}

// 我的资料
async function myProfile(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
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
            quota: user.quota,
            used_quota: user.used_quota,
            balance: Math.max(0, user.quota - user.used_quota),
            aff_code: user.aff_code || "",
            inviter_id: user.inviter_id,
        },
    });
}

// 我的用量: 汇总该用户各令牌 usage
async function myUsage(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const rows = await c.env.DB.prepare(
        "SELECT key, value, usage FROM api_token"
    ).all<{ key: string; value: string; usage: number }>();
    let totalUsage = 0;
    const perToken: { key: string; name: string; usage: number }[] = [];
    for (const row of rows.results || []) {
        try {
            const data = JSON.parse(row.value) as ApiTokenData;
            if (data.user_id === user.id) {
                totalUsage += row.usage || 0;
                perToken.push({ key: row.key, name: data.name || "", usage: row.usage || 0 });
            }
        } catch {
            // skip
        }
    }
    return c.json({
        success: true,
        data: {
            quota: user.quota,
            used_quota: user.used_quota,
            balance: Math.max(0, user.quota - user.used_quota),
            total_usage: totalUsage,
            tokens: perToken,
        },
    });
}

// 修改我的密码/显示名
async function updateMyProfile(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const displayName = typeof body.display_name === "string" ? String(body.display_name).slice(0, 30) : undefined;
    const newPassword = typeof body.password === "string" && body.password.length >= 6 ? String(body.password) : undefined;

    if (displayName === undefined && newPassword === undefined) {
        return c.json({ success: false, error: "Nothing to update" }, 400);
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (displayName !== undefined) { sets.push("display_name = ?"); params.push(displayName); }
    if (newPassword) {
        const { hash, salt } = await import("./auth").then((m) => m.hashPassword(newPassword));
        sets.push("password_hash = ?"); params.push(`${salt}:${hash}`);
    }
    sets.push("updated_at = datetime('now')");
    params.push(user.id);

    await c.env.DB.prepare(
        `UPDATE users SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...params).run();
    return c.json({ success: true, data: {} });
}

// 兑换码: 用户自助兑换, 为该用户增加额度 (原子)
async function redeemCode(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) {
        return c.json({ success: false, error: "Code is required" }, 400);
    }

    // 查找兑换码 (支持不带连字符的输入)
    const normalized = code.replace(/-/g, "");
    const result = await c.env.DB.prepare(
        `SELECT * FROM redemption WHERE replace(code, '-', '') = ? AND status = 1`
    ).bind(normalized).first();

    if (!result) {
        return c.json({ success: false, error: "Invalid redemption code" }, 404);
    }
    const redemption = result as any;
    if ((redemption.redeemed_count || 0) >= (redemption.count || 1)) {
        return c.json({ success: false, error: "Redemption code already used" }, 400);
    }

    const row = await c.env.DB.prepare(
        `SELECT quota FROM users WHERE id = ?`
    ).bind(user.id).first<{ quota: number }>();
    const currentQuota = row?.quota ?? user.quota;
    const addedQuota = Number(redemption.quota) || 0;
    // 余额逐次累加: quota += 兑换额度
    const newQuota = currentQuota === -1 ? -1 : (currentQuota || 0) + addedQuota;

    await c.env.DB.prepare(
        `UPDATE users SET quota = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newQuota, user.id).run();

    await c.env.DB.prepare(
        `UPDATE redemption
         SET redeemed_count = redeemed_count + 1, updated_at = datetime('now')
         WHERE id = ?`
    ).bind(redemption.id).run();

    return c.json({
        success: true,
        data: { added_quota: addedQuota, new_quota: newQuota },
    });
}

// 注册用户自助路由
export function registerUserApi(app: any) {
    app.get("/api/user/token", requireUser, MyTokenListEndpoint.handler);
    app.post("/api/user/token", requireUser, MyTokenCreateEndpoint.handler);
    app.delete("/api/user/token/:key", requireUser, deleteMyToken);
    app.get("/api/user/profile", requireUser, myProfile);
    app.put("/api/user/profile", requireUser, updateMyProfile);
    app.get("/api/user/usage", requireUser, myUsage);
    app.post("/api/user/redeem", requireUser, redeemCode);
}