import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { hashTokenKey } from "../analytics/usage-logger";

// ---------------------------------------------------------------------------
// 日志系统 (移植自 one-api: 日志统计/清理, 保持 one-api-cf 现有风格)
//   - 管理员: 全量统计 / 清理历史日志
//   - 用户:   自助日志列表 / 自助统计 (在 user/routes.ts 注册)
// usage_record 表已含全部调用明细, 此处直接复用, 不再新建日志表。
// ---------------------------------------------------------------------------

const toNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toText = (value: unknown): string => typeof value === "string" ? value : "";

// 解析 start/end (ISO 或 unix 秒) -> unix 秒 (秒)
const parseTimestamp = (value: string | undefined, fallbackSec: number): number => {
    if (!value) return fallbackSec;
    if (/^\d{10}$/.test(value)) return Number(value);
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
    return fallbackSec;
};

type LogStatQuery = {
    start?: string;
    end?: string;
    keyword?: string;
    dimension?: string;
};

// 统计: 请求数/成功/失败/消耗(tokens+成本), 支持按用户/令牌过滤
export async function queryLogStat(
    c: Context<HonoCustomType>,
    params: LogStatQuery & { tokenHashes?: string[] }
) {
    const endSec = parseTimestamp(params.end, Math.floor(Date.now() / 1000));
    const startSec = parseTimestamp(params.start, endSec - 24 * 3600);

    const clauses: string[] = ["timestamp >= ?", "timestamp <= ?"];
    const bindParams: unknown[] = [startSec, endSec];

    // 可选过滤: 令牌 hash 集合 (用户自助统计时传入)
    if (params.tokenHashes && params.tokenHashes.length > 0) {
        const placeholders = params.tokenHashes.map(() => "?").join(",");
        clauses.push(`token_hash IN (${placeholders})`);
        bindParams.push(...params.tokenHashes);
    }

    const where = `WHERE ${clauses.join(" AND ")}`;
    const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(success_flag) AS successes,
                SUM(total_tokens) AS total_tokens,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens,
                COALESCE(SUM(total_cost), 0) AS total_cost
         FROM usage_record ${where}`
    ).bind(...bindParams).first<Record<string, unknown>>();

    const total = toNumber(row?.total);
    const successes = toNumber(row?.successes);

    return {
        start: new Date(startSec * 1000).toISOString(),
        end: new Date(endSec * 1000).toISOString(),
        total,
        successes,
        failures: Math.max(0, total - successes),
        successRate: total > 0 ? successes / total : 0,
        totalTokens: toNumber(row?.total_tokens),
        promptTokens: toNumber(row?.prompt_tokens),
        completionTokens: toNumber(row?.completion_tokens),
        totalCost: toNumber(row?.total_cost),
    };
}

// 删除指定时间之前的日志 (管理员)
export async function deleteLogsBefore(
    c: Context<HonoCustomType>,
    targetTimestampSec: number
): Promise<number> {
    const result = await c.env.DB.prepare(
        "DELETE FROM usage_record WHERE timestamp < ?"
    ).bind(targetTimestampSec).run();
    return Number(result.meta?.changes || 0);
}

// 工具: 根据用户 id 收集其所有令牌 hash (用户自助日志/统计用)
export async function collectUserTokenHashes(
    c: Context<HonoCustomType>,
    userId: number
): Promise<string[]> {
    const rows = await c.env.DB.prepare(
        "SELECT key, value FROM api_token"
    ).all<{ key: string; value: string }>();
    const hashes: string[] = [];
    for (const row of rows.results || []) {
        try {
            const data = JSON.parse(row.value) as ApiTokenData;
            if (data.user_id === userId) {
                hashes.push(await hashTokenKey(row.key));
            }
        } catch {
            // skip
        }
    }
    return hashes;
}

// ---- 管理员: 日志统计 ----
export class LogStatEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage log statistics",
        request: {
            query: z.object({
                start: z.string().optional(),
                end: z.string().optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryLogStat(c, {
                start: c.req.query("start"),
                end: c.req.query("end"),
            });
            return { success: true, data: result } as CommonResponse;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to query log stats";
            return c.text(message, 500);
        }
    }
}

// ---- 管理员: 清理历史日志 (删除 target_timestamp 之前的记录) ----
export class LogCleanupEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Delete usage logs before a target timestamp",
        request: {
            query: z.object({
                targetTimestamp: z.string().optional(),
                days: z.coerce.number().int().min(1).max(3650).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            let targetSec = 0;
            const raw = c.req.query("targetTimestamp");
            if (raw) {
                targetSec = parseTimestamp(raw, 0);
            } else {
                const days = Math.min(Math.max(Number(c.req.query("days")) || 30, 1), 3650);
                targetSec = Math.floor(Date.now() / 1000) - days * 24 * 3600;
            }
            if (targetSec <= 0) {
                return c.text("targetTimestamp or days is required", 400);
            }
            const deleted = await deleteLogsBefore(c, targetSec);
            return { success: true, data: { deleted } } as CommonResponse;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete logs";
            return c.text(message, 500);
        }
    }
}

// ---- 管理员: 日志搜索 (复用现有查询, 提供与 one-api /api/log 对齐的视图) ----
export class AdminLogSearchEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Search usage logs (one-api compatible)",
        request: {
            query: z.object({
                start: z.string().optional(),
                end: z.string().optional(),
                dimension: z.string().optional(),
                keyword: z.string().optional(),
                result: z.enum(["all", "success", "failure"]).optional(),
                page: z.coerce.number().int().min(1).max(1000).optional(),
                pageSize: z.coerce.number().int().min(1).max(200).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const { queryUsageLogRecords } = await import("../analytics/query");
            const result = await queryUsageLogRecords(c, {
                start: c.req.query("start"),
                end: c.req.query("end"),
                dimension: c.req.query("dimension"),
                keyword: c.req.query("keyword"),
                result: c.req.query("result"),
                page: c.req.query("page"),
            });
            return { success: true, data: result } as CommonResponse;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to search logs";
            return c.text(message, 500);
        }
    }
}

// 兼容导出: 保持与 analytics 侧命名一致
export type { LogStatQuery };
