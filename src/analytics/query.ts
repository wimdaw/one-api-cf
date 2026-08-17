import { Context } from "hono";

import {
    queryLocalUsageOverview,
    queryLocalUsageTrend,
    queryLocalUsageBreakdown,
    queryLocalUsageEvents,
    queryLocalUsageLogRecords,
} from "./db-query";
import { t } from "../i18n";

// ---------------------------------------------------------------------------
// 用量分析查询 (统一 D1/本地数据库模式)
// Cloudflare Analytics Engine 已移除, 所有用量数据落在 usage_record 表,
// 本文件仅作为兼容层, 直接转发到 db-query.ts 的查询实现。
// ---------------------------------------------------------------------------

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";
export type AnalyticsBreakdownDimension = "token" | "channel" | "model" | "provider" | "user";

export type AnalyticsBreakdownData = {
    range: string;
    dimension: AnalyticsBreakdownDimension;
    items: Array<{
        label: string;
        requests: number;
        successes: number;
        failures: number;
        successRate: number;
        totalCost: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
        avgLatencyMs: number;
    }>;
};

export type UsageLogFilterDimension =
    | "route"
    | "token"
    | "channel"
    | "model"
    | "provider"
    | "requestId"
    | "traceId"
    | "clientIp"
    | "userAgent"
    | "country"
    | "region"
    | "city"
    | "colo"
    | "timezone"
    | "result"
    | "errorCode"
    | "errorSummary";

export type UsageLogQueryParams = {
    start?: string;
    end?: string;
    dimension?: string;
    keyword?: string;
    result?: string;
    page?: string;
};

export class AnalyticsQueryValidationError extends Error {}

export class AnalyticsQueryUpstreamError extends Error {
    readonly statusCode: number;

    constructor(message: string, statusCode = 502) {
        super(message);
        this.name = "AnalyticsQueryUpstreamError";
        this.statusCode = statusCode;
    }
}

export class AnalyticsQueryTimeoutError extends AnalyticsQueryUpstreamError {
    constructor(timeoutMs: number) {
        super(`Analytics query timed out after ${timeoutMs}ms`, 504);
        this.name = "AnalyticsQueryTimeoutError";
    }
}

// ---- 概览 ----
export const queryUsageOverview = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    tokenHashes?: string[]
) => {
    return queryLocalUsageOverview(c, requestedRange, tokenHashes);
};

// ---- 趋势 ----
export const queryUsageTrend = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    tokenHashes?: string[]
) => {
    return queryLocalUsageTrend(c, requestedRange, tokenHashes);
};

// ---- 分布 ----
export const queryUsageBreakdown = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    requestedDimension?: string,
    tokenHashes?: string[]
) => {
    return queryLocalUsageBreakdown(c, requestedRange, requestedDimension, tokenHashes);
};

// ---- 事件(最近样本) ----
export const queryUsageEvents = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    requestedLimit?: string
) => {
    return queryLocalUsageEvents(c, requestedRange, requestedLimit);
};

// ---- 日志检索 ----
export const queryUsageLogRecords = async (
    c: Context<HonoCustomType>,
    params: UsageLogQueryParams
) => {
    return queryLocalUsageLogRecords(c, params);
};

// 保留语言相关辅助 (供调用方使用)
export { t };
