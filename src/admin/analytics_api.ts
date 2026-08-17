import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { AnalyticsBreakdownData } from "../analytics/query";
import {
    AnalyticsQueryUpstreamError,
    AnalyticsQueryValidationError,
    queryUsageOverview,
    queryUsageTrend,
    queryUsageBreakdown,
    queryUsageEvents,
    queryUsageLogRecords,
} from "../analytics/query";
import { hashTokenKey } from "../analytics/usage-logger";

// 用户排行: 把 token_hash 映射为用户名 (通过 api_token.user_id -> users.username)
async function mapTokenHashesToUsers(
    c: Context<HonoCustomType>,
    items: AnalyticsBreakdownData["items"]
): Promise<AnalyticsBreakdownData["items"]> {
    try {
        const tokenRows = await c.env.DB.prepare(
            "SELECT key, value FROM api_token"
        ).all<{ key: string; value: string }>();

        // token_hash -> username 映射
        const hashToUser = new Map<string, string>();
        const userIds = new Set<number>();
        for (const row of tokenRows.results || []) {
            try {
                const data = JSON.parse(row.value) as ApiTokenData;
                if (data.user_id && data.user_id > 0) {
                    hashToUser.set(await hashTokenKey(row.key), `user:${data.user_id}`);
                    userIds.add(data.user_id);
                }
            } catch {
                // skip
            }
        }

        // 批量拉用户名
        const userMap = new Map<number, string>();
        if (userIds.size > 0) {
            const placeholders = [...userIds].map(() => "?").join(",");
            const users = await c.env.DB.prepare(
                `SELECT id, username FROM users WHERE id IN (${placeholders})`
            ).bind(...[...userIds]).all<{ id: number; username: string }>();
            for (const u of users.results || []) {
                userMap.set(Number(u.id), u.username);
            }
        }

        return items.map((item) => {
            const mapped = hashToUser.get(item.label);
            if (mapped && mapped.startsWith("user:")) {
                const uid = Number(mapped.slice(5));
                const username = userMap.get(uid);
                if (username) {
                    return { ...item, label: username };
                }
            }
            return { ...item, label: item.label === "" ? "anonymous" : item.label };
        });
    } catch (error) {
        console.error("mapTokenHashesToUsers error:", error);
        return items;
    }
}

const rangeSchema = z.enum(["24h", "7d", "30d", "90d"]).optional();
type AnalyticsErrorStatus = 400 | 401 | 403 | 404 | 429 | 500 | 502 | 504;

const toAnalyticsErrorStatus = (error: unknown): AnalyticsErrorStatus => {
    if (error instanceof AnalyticsQueryValidationError) {
        return 400;
    }

    if (error instanceof AnalyticsQueryUpstreamError) {
        switch (error.statusCode) {
            case 401:
            case 403:
            case 404:
            case 429:
            case 504:
                return error.statusCode;
            default:
                return 502;
        }
    }

    return 500;
};

const toErrorResponse = (
    c: Context<HonoCustomType>,
    error: unknown,
    fallbackMessage: string
) => {
    const message = error instanceof Error ? error.message : fallbackMessage;
    return c.text(message, toAnalyticsErrorStatus(error));
};

export class AnalyticsOverviewEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage analytics overview",
        request: {
            query: z.object({
                range: rangeSchema,
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageOverview(c, c.req.query("range"));
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics overview");
        }
    }
}

export class AnalyticsTrendEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage analytics time series",
        request: {
            query: z.object({
                range: rangeSchema,
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageTrend(c, c.req.query("range"));
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics trend");
        }
    }
}

export class AnalyticsBreakdownEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get usage analytics breakdown",
        request: {
            query: z.object({
                range: rangeSchema,
                dimension: z.enum(["token", "channel", "model", "provider", "user"]).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageBreakdown(
                c,
                c.req.query("range"),
                c.req.query("dimension")
            ) as AnalyticsBreakdownData;

            // 用户排行: 把 token_hash 映射为用户名
            if (c.req.query("dimension") === "user" && result?.items?.length) {
                result.items = await mapTokenHashesToUsers(c, result.items);
            }

            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics breakdown");
        }
    }
}

export class AnalyticsEventsEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get recent usage analytics samples",
        request: {
            query: z.object({
                range: rangeSchema,
                limit: z.coerce.number().min(1).max(100).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageEvents(
                c,
                c.req.query("range"),
                c.req.query("limit")
            );
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query analytics events");
        }
    }
}

export class UsageLogSearchEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Search usage logs with custom filters",
        request: {
            query: z.object({
                start: z.string().optional(),
                end: z.string().optional(),
                dimension: z.enum([
                    "route",
                    "token",
                    "channel",
                    "model",
                    "provider",
                    "requestId",
                    "traceId",
                    "clientIp",
                    "userAgent",
                    "country",
                    "region",
                    "city",
                    "colo",
                    "timezone",
                    "result",
                    "errorCode",
                    "errorSummary",
                ]).optional(),
                keyword: z.string().optional(),
                result: z.enum(["all", "success", "failure"]).optional(),
                page: z.coerce.number().int().min(1).max(1000).optional(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        try {
            const result = await queryUsageLogRecords(c, {
                start: c.req.query("start"),
                end: c.req.query("end"),
                dimension: c.req.query("dimension"),
                keyword: c.req.query("keyword"),
                result: c.req.query("result"),
                page: c.req.query("page"),
            });
            return {
                success: true,
                data: result,
            } as CommonResponse;
        } catch (error) {
            return toErrorResponse(c, error, "Failed to query usage logs");
        }
    }
}
