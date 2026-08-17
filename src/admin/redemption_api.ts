import { Context } from "hono";
import { dollarsToRaw } from "../billing";

// 兑换码管理 API (one-api 移植)
// 管理员生成兑换码; 用户在个人中心输入兑换码充值额度

// 生成兑换码 (可批量)
export const RedemptionCreateEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const body = await c.req.json().catch(() => ({}));
        const quota = Number(body.quota) || 0;
        const quotaRaw = dollarsToRaw(quota);
        const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
        const name = String(body.name || "").trim();

        if (quota <= 0) {
            return c.json({ success: false, error: "Quota must be positive" }, 400);
        }

        const codes: string[] = [];
        for (let i = 0; i < count; i += 1) {
            const code = generateRedemptionCode();
            await c.env.DB.prepare(
                `INSERT INTO redemption (code, quota, count, redeemed_count, status)
                 VALUES (?, ?, 1, 0, 1)`
            ).bind(code, quotaRaw).run();
            codes.push(code);
        }

        return c.json({ success: true, data: { codes, count: codes.length } });
    },
};

// 兑换码列表
export const RedemptionListEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const result = await c.env.DB.prepare(
            `SELECT id, code, quota, count, redeemed_count, status, created_at
             FROM redemption ORDER BY id DESC LIMIT 200`
        ).all();
        return c.json({ success: true, data: { redemptions: result.results || [] } });
    },
};

// 删除兑换码
export const RedemptionDeleteEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const id = Number(c.req.param("id"));
        const result = await c.env.DB.prepare(
            "DELETE FROM redemption WHERE id = ?"
        ).bind(id).run();
        return c.json({ success: true, data: { changes: result.meta?.changes || 0 } });
    },
};

// 兑换码: 大写字母数字, 不含易混淆字符
function generateRedemptionCode(): string {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 16; i += 1) {
        code += charset[Math.floor(Math.random() * charset.length)];
    }
    // 每 4 位一组便于输入: XXXX-XXXX-XXXX-XXXX
    return code.match(/.{4}/g)!.join("-");
}