import { Context } from "hono";
import { dollarsToRaw } from "../billing";

// 邀请码管理 API
// 后台生成邀请码; 用户注册时填写邀请码校验, 并获赠注册额度

const INVITE_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateInviteCode = (): string => {
    let code = "";
    for (let i = 0; i < 8; i += 1) {
        code += INVITE_CODE_CHARSET[Math.floor(Math.random() * INVITE_CODE_CHARSET.length)];
    }
    return code;
};

// 生成邀请码 (可批量)
export const InviteCodeCreateEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const body = await c.req.json().catch(() => ({}));
        const quota = Number(body.quota) || 0;
        const quotaRaw = dollarsToRaw(quota);
        const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);

        if (quota <= 0) {
            return c.json({ success: false, error: "Quota must be positive" }, 400);
        }

        const codes: string[] = [];
        for (let i = 0; i < count; i += 1) {
            const code = generateInviteCode();
            await c.env.DB.prepare(
                `INSERT INTO invite_code (code, quota, count, used_count, status)
                 VALUES (?, ?, 1, 0, 1)`
            ).bind(code, quotaRaw).run();
            codes.push(code);
        }

        return c.json({ success: true, data: { codes, count: codes.length } });
    },
};

// 邀请码列表
export const InviteCodeListEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const result = await c.env.DB.prepare(
            `SELECT id, code, quota, count, used_count, status, created_at
             FROM invite_code ORDER BY id DESC LIMIT 200`
        ).all();
        return c.json({ success: true, data: { inviteCodes: result.results || [] } });
    },
};

// 删除邀请码
export const InviteCodeDeleteEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const id = Number(c.req.param("id"));
        const result = await c.env.DB.prepare(
            `DELETE FROM invite_code WHERE id = ?`
        ).bind(id).run();
        return c.json({ success: true, data: { changes: result.meta?.changes } });
    },
};
