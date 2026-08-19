import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { BillingConfig, normalizeBillingConfig } from "../billing";
import { dollarsToRaw, rawToDollars } from "../billing";
import { getSystemConfig, saveSystemConfig } from "../system-config";
import { findUserById } from "../user/auth";

const billingConfigSchema = z.object({
    displayDecimals: z.number().int().min(0).max(9),
});

export class BillingConfigGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get billing display configuration",
        responses: {
            ...CommonSuccessfulResponse(billingConfigSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        return {
            success: true,
            data: normalizeBillingConfig(await getSystemConfig(c)),
        } as CommonResponse;
    }
}

export class BillingConfigUpdateEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Update billing display configuration",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: billingConfigSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(billingConfigSchema),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const body = await c.req.json<BillingConfig>();
        const currentSystemConfig = await getSystemConfig(c);
        const config = normalizeBillingConfig(body);

        await saveSystemConfig(c, {
            ...currentSystemConfig,
            displayDecimals: config.displayDecimals,
        });

        return {
            success: true,
            data: config,
            message: "Billing config updated successfully",
        } as CommonResponse;
    }
}

// ---------------------------------------------------------------------------
// 充值系统 (移植自 one-api: AdminTopUp / 充值记录)
//   - 管理员: 给指定用户直接增加额度 (记录 remark)
//   - 用户自助: 兑换码充值已由 /api/user/redeem 覆盖
// ---------------------------------------------------------------------------

export class AdminTopUpEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Admin top up a user's quota directly",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            user_id: z.number().int().positive().describe("Target user id"),
                            quota: z.number().positive().describe("Quota amount in dollars to add"),
                            remark: z.string().optional().describe("Remark for this top up"),
                        }),
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const body = await c.req.json().catch(() => ({}));
        const userId = Number(body.user_id);
        const quotaDollars = Number(body.quota);
        const remark = typeof body.remark === "string" ? String(body.remark).slice(0, 200) : "";

        if (!Number.isInteger(userId) || userId <= 0) {
            return c.text("user_id is required", 400);
        }
        if (!Number.isFinite(quotaDollars) || quotaDollars <= 0) {
            return c.text("quota must be a positive number", 400);
        }

        const target = await findUserById(c, userId);
        if (!target) {
            return c.text("User not found", 404);
        }

        const quotaRaw = dollarsToRaw(quotaDollars);
        // -1 = 无限额度保持不变; 否则累加
        if (target.quota !== -1) {
            await c.env.DB.prepare(
                "UPDATE users SET quota = quota + ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(quotaRaw, userId).run();
        }

        // 记录充值流水
        await c.env.DB.prepare(
            `INSERT INTO topup_record (user_id, username, amount, amount_raw, remark, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`
        ).bind(userId, target.username, quotaDollars, quotaRaw, remark).run();

        const updated = await findUserById(c, userId);
        return {
            success: true,
            data: {
                user_id: userId,
                username: target.username,
                added_quota: quotaDollars,
                new_quota: updated?.quota === -1 ? -1 : rawToDollars(updated?.quota || 0),
                balance: updated?.quota === -1 ? -1 : Math.max(0, rawToDollars((updated?.quota || 0) - (updated?.used_quota || 0))),
            },
        } as CommonResponse;
    }
}

// 充值记录查询 (管理员)
export class TopUpRecordListEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "List top up records",
        request: {
            query: z.object({
                userId: z.coerce.number().int().positive().optional(),
                page: z.coerce.number().int().min(1).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const userId = c.req.query("userId");
        const page = Math.max(Number(c.req.query("page")) || 1, 1);
        const pageSize = 50;
        const offset = (page - 1) * pageSize;

        let sql = `SELECT id, user_id, username, amount, amount_raw, remark, created_at FROM topup_record`;
        const params: unknown[] = [];
        if (userId) {
            sql += ` WHERE user_id = ?`;
            params.push(Number(userId));
        }
        sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
        params.push(pageSize, offset);

        const countRow = await c.env.DB.prepare(
            userId
                ? `SELECT COUNT(*) AS total FROM topup_record WHERE user_id = ?`
                : `SELECT COUNT(*) AS total FROM topup_record`
        ).bind(...(userId ? [Number(userId)] : [])).first<{ total: number }>();

        const rows = await c.env.DB.prepare(sql).bind(...params).all();

        return {
            success: true,
            data: {
                total: Number(countRow?.total || 0),
                page,
                pageSize,
                items: (rows.results || []).map((row: any) => ({
                    ...row,
                    amount: rawToDollars(row.amount_raw || 0),
                })),
            },
        } as CommonResponse;
    }
}
