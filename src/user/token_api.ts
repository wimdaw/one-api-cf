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
                // 透传完整 value (含 channel_keys/expires_at), 供操练场按渠道过滤
                value: row.value,
                name: data.name,
                // 保持 raw 返回, 前端 formatQuotaInputValue 统一换算为美元显示
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
        // 可选有效期 (ms 时间戳), 校验为未来时间
        let expiresAt: number | undefined;
        const rawExpiry = Number(body.expires_at);
        if (Number.isFinite(rawExpiry) && rawExpiry > 0) {
            const expiryMs = rawExpiry < 1e12 ? rawExpiry * 1000 : rawExpiry;
            if (expiryMs > Date.now()) {
                expiresAt = expiryMs;
            } else {
                return c.json({ success: false, error: "Expiry must be in the future" }, 400);
            }
        }

        if (!name) {
            return c.json({ success: false, error: "Name is required" }, 400);
        }

        // 渠道: 不传则默认绑定全部渠道 (最高权限, 可调用当前用户能用的所有渠道)
        let channelKeys: string[];
        const rawChannels = Array.isArray(body.channel_keys) ? body.channel_keys.filter((c: unknown) => typeof c === "string") : null;
        if (rawChannels && rawChannels.length > 0) {
            channelKeys = rawChannels;
        } else {
            const all = await c.env.DB.prepare(`SELECT key FROM channel_config`).all<{ key: string }>();
            channelKeys = (all.results || []).map((r) => r.key);
        }

        // 校验用户余额 (除非无限额度)
        const isUnlimited = user.quota === -1;
        const balance = isUnlimited ? -1 : Math.max(0, user.quota - user.used_quota);
        if (!isUnlimited && totalQuota !== -1 && totalQuota > balance) {
            return c.json({ success: false, error: "Insufficient balance" }, 400);
        }

        const key = `sk-${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
        const value = JSON.stringify({
            name,
            channel_keys: channelKeys,
            total_quota: totalQuota,
            user_id: user.id,
            expires_at: expiresAt,
        } as ApiTokenData);

        await c.env.DB.prepare(
            `INSERT INTO api_token (key, value, usage) VALUES (?, ?, 0)`
        ).bind(key, value).run();

        return c.json({ success: true, data: { key, name, total_quota: totalQuota } });
    },
};