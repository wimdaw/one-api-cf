import { Context } from "hono";
import { getCurrentUser, requireUser } from "./api";
import { hashTokenKey } from "../analytics/usage-logger";
import { MyTokenListEndpoint, MyTokenCreateEndpoint } from "./token_api";
import { getJsonSetting } from "../utils";
import { CONSTANTS } from "../constants";
import { getSystemConfig } from "../system-config";
import { normalizeBillingConfig, rawToDollars, dollarsToRaw } from "../billing";

// 我的计费展示配置 (只读, 普通用户可读, 用于显示金额单位)
async function myBilling(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    return c.json({ success: true, data: normalizeBillingConfig(await getSystemConfig(c)) });
}

// 我的资料定价 (只读, 普通用户可查看定价, 不可编辑)
async function myPricing(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const pricing = await getJsonSetting<Record<string, any>>(c, CONSTANTS.MODEL_PRICING_KEY);
    return c.json({ success: true, data: pricing || {} });
}

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
            quota: user.quota === -1 ? -1 : rawToDollars(user.quota),
            used_quota: user.quota === -1 ? rawToDollars(user.used_quota) : rawToDollars(user.used_quota),
            balance: user.quota === -1 ? -1 : Math.max(0, rawToDollars(user.quota - user.used_quota)),
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
            quota: user.quota === -1 ? -1 : rawToDollars(user.quota),
            used_quota: user.quota === -1 ? rawToDollars(user.used_quota) : rawToDollars(user.used_quota),
            balance: user.quota === -1 ? -1 : Math.max(0, rawToDollars(user.quota - user.used_quota)),
            total_usage: rawToDollars(totalUsage),
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

    // 修改密码必须验证旧密码
    if (newPassword) {
        const oldPassword = typeof body.old_password === "string" ? String(body.old_password) : "";
        if (!oldPassword) {
            return c.json({ success: false, error: "Old password is required" }, 400);
        }
        const [salt, storedHash] = (user.password_hash || "").split(":");
        if (!salt || !storedHash) {
            return c.json({ success: false, error: "Invalid account state" }, 500);
        }
        const { verifyPassword } = await import("./auth");
        const ok = await verifyPassword(oldPassword, storedHash, salt);
        if (!ok) {
            return c.json({ success: false, error: "Old password is incorrect" }, 403);
        }
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
    // redemption.quota 为美元, 转 raw 后逐次累加
    const addedQuotaRaw = dollarsToRaw(Number(redemption.quota) || 0);
    const newQuota = currentQuota === -1 ? -1 : (currentQuota || 0) + addedQuotaRaw;

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
        data: { added_quota: rawToDollars(addedQuotaRaw), new_quota: newQuota === -1 ? -1 : rawToDollars(newQuota) },
    });
}

// 我的调用看板: 统计我自己的 token 用量 (与全局分析同结构, 按用户 token 过滤)
async function myAnalytics(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) {
        return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    // 该用户所有 token 的 hash
    const tokenRows = await c.env.DB.prepare(
        "SELECT key, value FROM api_token"
    ).all<{ key: string; value: string }>();
    const hashes: string[] = [];
    for (const row of tokenRows.results || []) {
        try {
            const data = JSON.parse(row.value) as ApiTokenData;
            if (data.user_id === user.id) {
                hashes.push(await hashTokenKey(row.key));
            }
        } catch {
            // skip
        }
    }

    const url = new URL(c.req.url);
    const range = url.searchParams.get("range") || "24h";
    const dimension = url.searchParams.get("dimension") || "token";

    const { queryLocalUsageOverview, queryLocalUsageTrend, queryLocalUsageBreakdown } = await import("../analytics/db-query");

    const [overview, trend, breakdown] = await Promise.all([
        hashes.length === 0
            ? { requests: 0, successes: 0, total_cost: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, successRate: 0 }
            : queryLocalUsageOverview(c, range, hashes),
        hashes.length === 0 ? [] : queryLocalUsageTrend(c, range, hashes),
        hashes.length === 0 ? [] : queryLocalUsageBreakdown(c, range, dimension, hashes),
    ]);

    return c.json({
        success: true,
        data: { overview, trend, breakdown },
    });
}

// 用户可访问的渠道列表: 根据用户令牌的 channel_keys 过滤
async function myChannels(c: Context<HonoCustomType>) {
    const user = getCurrentUser(c);
    if (!user) return c.json({ success: false, error: "Unauthorized" }, 401);

    const rows = await c.env.DB.prepare(
        "SELECT key, value FROM channel_config"
    ).all<{ key: string; value: string }>();

    const tokenRows = await c.env.DB.prepare(
        "SELECT key, value FROM api_token"
    ).all<{ key: string; value: string }>();

    const allowedChannels = new Set<string>();
    for (const row of tokenRows.results || []) {
        try {
            const data = JSON.parse(row.value);
            if (data.user_id === user.id) {
                const keys = data.channel_keys;
                if (Array.isArray(keys) && keys.length > 0) {
                    keys.forEach((k: string) => allowedChannels.add(k));
                } else {
                    // 空 channel_keys = 有全部渠道权限
                    allowedChannels.clear();
                    break;
                }
            }
        } catch { continue; }
    }

    const result = (rows.results || []).filter((row) => {
        if (allowedChannels.size === 0) return true;
        return allowedChannels.has(row.key);
    });

    return c.json({ success: true, data: result });
}

// 注册用户自助路由
export function registerUserApi(app: any) {
    app.get("/api/user/token", requireUser, MyTokenListEndpoint.handler);
    app.post("/api/user/token", requireUser, MyTokenCreateEndpoint.handler);
    app.delete("/api/user/token/:key", requireUser, deleteMyToken);
    app.get("/api/user/profile", requireUser, myProfile);
    app.get("/api/user/pricing", requireUser, myPricing);
    app.get("/api/user/billing", requireUser, myBilling);
    app.put("/api/user/profile", requireUser, updateMyProfile);
    app.get("/api/user/usage", requireUser, myUsage);
    app.post("/api/user/redeem", requireUser, redeemCode);
    app.get("/api/user/analytics", requireUser, myAnalytics);
    app.get("/api/user/channels", requireUser, myChannels);
}