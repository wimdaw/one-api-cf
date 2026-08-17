import { Context } from "hono";
import { TokenUtils } from "../admin/token_utils";
import { getCurrentUser } from "./api";

// 用户自助令牌 API (one-api 移植: 用户管理自己的 API Key)

// 我的令牌列表
export const MyTokenListEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const user = getCurrentUser(c);
        if (!user) {
            return c.json({ success: false, error: "Unauthorized" }, 401);
        }
        const result = await c.env.DB.prepare(
            `SELECT * FROM api_token ORDER BY created_at DESC`
        ).all<ApiTokenRow>();
        const mine = (result.results || []).filter((row) => {
            try {
                const data = JSON.parse(row.value || "{}") as ApiTokenData;
                return data.user_id === user.id;
            } catch {
                return false;
            }
        });
        const tokens = mine.map((row) => {
            const data = JSON.parse(row.value || "{}") as ApiTokenData;
            return {
                key: row.key,
                name: data.name,
                total_quota: data.total_quota,
                usage: row.usage,
                created_at: row.created_at,
            };
        });
        return c.json({ success: true, data: { tokens } });
    },
};

// 创建我的令牌
export const MyTokenCreateEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const user = getCurrentUser(c);
        if (!user) {
            return c.json({ success: false, error: "Unauthorized" }, 401);
        }
        const body = await c.req.json().catch(() => ({}));
        const name = String(body.name || "").trim();
        const totalQuota = body.total_quota === -1 ? -1 : Number(body.total_quota) || 0;

        if (!name) {
            return c.json({ success: false, error: "Name is required" }, 400);
        }

        // 校验用户余额 (除非无限额度)
        const balance = Math.max(0, user.quota - user.used_quota);
        if (totalQuota !== -1 && totalQuota > balance) {
            return c.json({ success: false, error: "Insufficient balance" }, 400);
        }

        const key = `sk-${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
        const value = JSON.stringify({
            name,
            channel_keys: [],
            total_quota: totalQuota,
            user_id: user.id,
        } as ApiTokenData);

        await c.env.DB.prepare(
            `INSERT INTO api_token (key, value, usage) VALUES (?, ?, 0)`
        ).bind(key, value).run();

        return c.json({ success: true, data: { key, name, total_quota: totalQuota } });
    },
};