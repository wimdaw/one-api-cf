import { Context } from "hono";

import type { D1Like } from "../storage/sqlite";

// env.DB 在不同环境下类型为 D1Database 或 D1Like, 统一转 D1Like
const getDb = (c: Context<HonoCustomType>): D1Like => {
    return (c.env.DB as unknown) as D1Like;
};

// ---------------------------------------------------------------------------
// 本地数据库模式分析查询 (Docker/自托管)
// 当无 Cloudflare Analytics Engine 绑定、但存在 DB 时, 用量记录落在 usage_record 表
// 本文件实现与 query.ts 相同返回结构的 5 个查询 (Overview/Trend/Breakdown/Events/Log)
// timestamp 存储为 INTEGER UNIX 秒
// ---------------------------------------------------------------------------

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";
export type AnalyticsBreakdownDimension = "token" | "channel" | "model" | "provider" | "user";
export type UsageLogFilterDimension =
    | "route" | "token" | "channel" | "model" | "provider"
    | "requestId" | "traceId" | "clientIp" | "userAgent"
    | "country" | "region" | "city" | "colo" | "timezone"
    | "result" | "errorCode" | "errorSummary";

type UsageLogQueryParams = {
    start?: string;
    end?: string;
    dimension?: string;
    keyword?: string;
    result?: string;
    page?: string;
};

const USAGE_LOG_PAGE_SIZE = 50;

const RANGE_LOOKBACK_SECONDS: Record<AnalyticsRange, number> = {
    "24h": 24 * 3600,
    "7d": 7 * 24 * 3600,
    "30d": 30 * 24 * 3600,
    "90d": 90 * 24 * 3600,
};

const RANGE_BUCKET_SECONDS: Record<AnalyticsRange, number> = {
    "24h": 3600,
    "7d": 24 * 3600,
    "30d": 24 * 3600,
    "90d": 24 * 3600,
};

const BREAKDOWN_COLUMNS: Record<AnalyticsBreakdownDimension, string> = {
    token: "token_name",
    channel: "channel_key",
    model: "requested_model",
    provider: "provider_type",
    user: "token_hash",
};

const LOG_FILTER_COLUMNS: Record<UsageLogFilterDimension, string> = {
    route: "route_id",
    token: "token_name",
    channel: "channel_key",
    model: "requested_model",
    provider: "provider_type",
    requestId: "request_id",
    traceId: "trace_id",
    clientIp: "client_ip",
    userAgent: "user_agent",
    country: "country",
    region: "region",
    city: "city",
    colo: "colo",
    timezone: "timezone",
    result: "result",
    errorCode: "error_code",
    errorSummary: "error_summary",
};

const getRange = (requested?: string): AnalyticsRange => {
    return (requested && requested in RANGE_LOOKBACK_SECONDS ? requested : "24h") as AnalyticsRange;
};

const normalizeTimestamps = <T>(rows: T[]): T[] => rows;

const toNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toText = (value: unknown): string => typeof value === "string" ? value : "";

const toIsoTimestamp = (value: unknown): string => {
    const secs = toNumber(value);
    return secs > 0 ? new Date(secs * 1000).toISOString() : "";
};


// 构建 token 过滤子句 (动态 IN 占位符, 兼容 SQLite/MySQL/PG)
const buildTokenFilter = (tokenHashes?: string[]): { clause: string; params: number[] } => {
    if (!tokenHashes || tokenHashes.length === 0) {
        return { clause: "", params: [] };
    }
    const placeholders = tokenHashes.map(() => "?").join(",");
    return { clause: ` AND token_hash IN (${placeholders})`, params: tokenHashes as unknown as number[] };
};

const buildRangeStartSeconds = (range: AnalyticsRange): number => {
    return Math.floor(Date.now() / 1000) - RANGE_LOOKBACK_SECONDS[range];
};

const buildBucketTimestamps = (range: AnalyticsRange): number[] => {
    const bucketSize = RANGE_BUCKET_SECONDS[range];
    const bucketCount = Math.ceil(RANGE_LOOKBACK_SECONDS[range] / bucketSize);
    const now = Math.floor(Date.now() / 1000);
    const latestBucket = Math.floor(now / bucketSize) * bucketSize;
    const start = latestBucket - (bucketCount - 1) * bucketSize;
    return Array.from({ length: bucketCount }, (_, idx) => start + idx * bucketSize);
};

// ---- 概览 ----
export const queryLocalUsageOverview = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    tokenHashes?: string[]
) => {
    const range = getRange(requestedRange);
    const startSec = buildRangeStartSeconds(range);
    const tokenFilter = buildTokenFilter(tokenHashes);
    // usage_record 表在 timestamp 存秒; 保证 DB 存在
    const db = getDb(c);
    const row = await db.prepare(
        `SELECT COUNT(*) AS requests,
                SUM(success_flag) AS successes,
                SUM(total_cost) AS total_cost,
                SUM(total_tokens) AS total_tokens,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
         FROM usage_record WHERE timestamp >= ?${tokenFilter.clause}`
    ).bind(startSec, ...tokenFilter.params).first<Record<string, unknown>>();

    const requests = toNumber(row?.requests);
    const successes = toNumber(row?.successes);
    return {
        range,
        totals: {
            requests,
            successes,
            failures: Math.max(0, requests - successes),
            successRate: requests > 0 ? successes / requests : 0,
            totalCost: toNumber(row?.total_cost),
            totalTokens: toNumber(row?.total_tokens),
            promptTokens: toNumber(row?.prompt_tokens),
            completionTokens: toNumber(row?.completion_tokens),
            avgLatencyMs: toNumber(row?.avg_latency_ms),
        },
    };
};

// ---- 趋势 ----
export const queryLocalUsageTrend = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    tokenHashes?: string[]
) => {
    const range = getRange(requestedRange);
    const bucketSize = RANGE_BUCKET_SECONDS[range];
    const bucketTimestamps = buildBucketTimestamps(range);
    const startSec = Math.min(...bucketTimestamps);
    const endSec = Math.max(...bucketTimestamps) + bucketSize;
    const tokenFilter = buildTokenFilter(tokenHashes);

    const db = getDb(c);
    // 用整数除法时间桶(所有数据库通用): FLOOR(timestamp / bucketSize)
    const rows = await db.prepare(
        `SELECT (timestamp / ?) AS bucket_idx, FLOOR(timestamp / ?) * ? AS bucket_ts,
                COUNT(*) AS requests, SUM(success_flag) AS successes, SUM(total_cost) AS total_cost
         FROM usage_record WHERE timestamp >= ? AND timestamp < ?${tokenFilter.clause}
         GROUP BY bucket_idx, bucket_ts ORDER BY bucket_ts ASC`
    ).bind(bucketSize, bucketSize, bucketSize, startSec, endSec, ...tokenFilter.params).all<Record<string, unknown>>();

    const rowsByBucket = new Map<number, Record<string, unknown>>();
    normalizeTimestamps(rows.results).forEach((row) => {
        rowsByBucket.set(toNumber(row.bucket_ts), row);
    });

    return {
        range,
        bucket: range === "24h" ? "1h" : "1d",
        points: bucketTimestamps.map((bucketTimestamp) => {
            const row = rowsByBucket.get(bucketTimestamp) || {};
            const requests = toNumber(row.requests);
            const successes = toNumber(row.successes);
            return {
                timestamp: new Date(bucketTimestamp * 1000).toISOString(),
                requests,
                successes,
                failures: Math.max(0, requests - successes),
                successRate: requests > 0 ? successes / requests : 0,
                totalCost: toNumber(row.total_cost),
            };
        }),
    };
};

// ---- 分布 ----
export const queryLocalUsageBreakdown = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    requestedDimension?: string,
    tokenHashes?: string[]
) => {
    const range = getRange(requestedRange);
    const dimension = (requestedDimension && requestedDimension in BREAKDOWN_COLUMNS
        ? requestedDimension : "token") as AnalyticsBreakdownDimension;
    const startSec = buildRangeStartSeconds(range);
    const column = BREAKDOWN_COLUMNS[dimension];
    const tokenFilter = buildTokenFilter(tokenHashes);
    const db = getDb(c);
    const rows = await db.prepare(
        `SELECT ${column} AS label, COUNT(*) AS requests, SUM(success_flag) AS successes,
                SUM(total_cost) AS total_cost, SUM(total_tokens) AS total_tokens,
                SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
         FROM usage_record WHERE timestamp >= ? AND ${column} != ''${tokenFilter.clause}
         GROUP BY label ORDER BY requests DESC, total_cost DESC LIMIT 12`
    ).bind(startSec, ...tokenFilter.params).all<Record<string, unknown>>();

    return {
        range,
        dimension,
        items: rows.results.map((row) => {
            const requests = toNumber(row.requests);
            const successes = toNumber(row.successes);
            return {
                label: toText(row.label),
                requests,
                successes,
                failures: Math.max(0, requests - successes),
                successRate: requests > 0 ? successes / requests : 0,
                totalCost: toNumber(row.total_cost),
                totalTokens: toNumber(row.total_tokens),
                promptTokens: toNumber(row.prompt_tokens),
                completionTokens: toNumber(row.completion_tokens),
                avgLatencyMs: toNumber(row.avg_latency_ms),
            };
        }),
    };
};

const mapEventRow = (row: Record<string, unknown>) => ({
    timestamp: toIsoTimestamp(row.timestamp),
    routeId: toText(row.route_id),
    tokenName: toText(row.token_name),
    channelKey: toText(row.channel_key),
    providerType: toText(row.provider_type),
    requestedModel: toText(row.requested_model),
    upstreamModel: toText(row.upstream_model),
    result: toText(row.result),
    streamMode: toText(row.stream_mode),
    errorCode: toText(row.error_code),
    statusFamily: toText(row.status_family),
    requestId: toText(row.request_id),
    traceId: toText(row.trace_id),
    clientIp: toText(row.client_ip),
    userAgent: toText(row.user_agent),
    country: toText(row.country),
    region: toText(row.region),
    city: toText(row.city),
    colo: toText(row.colo),
    timezone: toText(row.timezone),
    errorSummary: toText(row.error_summary),
    promptTokens: toNumber(row.prompt_tokens),
    completionTokens: toNumber(row.completion_tokens),
    cachedTokens: toNumber(row.cached_tokens),
    totalTokens: toNumber(row.total_tokens),
    totalCost: toNumber(row.total_cost),
    cacheCost: toNumber(row.cache_cost),
    latencyMs: toNumber(row.latency_ms),
    retryCount: toNumber(row.retry_count),
    upstreamStatus: toNumber(row.upstream_status),
});

// ---- 事件(最近样本) ----
export const queryLocalUsageEvents = async (
    c: Context<HonoCustomType>,
    requestedRange?: string,
    requestedLimit?: string
) => {
    const range = getRange(requestedRange);
    const startSec = buildRangeStartSeconds(range);
    const limit = Math.min(Math.max(Number(requestedLimit || 40) || 40, 1), 100);
    const db = getDb(c);
    const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM usage_record WHERE timestamp >= ?`).bind(startSec).first<Record<string, unknown>>();
    const total = toNumber(countRow?.total);

    if (total === 0) {
        return { range, sampled: true, compatibilityWarning: undefined, items: [] };
    }

    const rows = await db.prepare(
        `SELECT * FROM usage_record WHERE timestamp >= ? ORDER BY timestamp DESC, id DESC LIMIT ?`
    ).bind(startSec, limit).all<Record<string, unknown>>();

    return {
        range,
        sampled: true,
        compatibilityWarning: undefined,
        items: rows.results.map(mapEventRow),
    };
};

// ---- 日志检索 ----
export const queryLocalUsageLogRecords = async (
    c: Context<HonoCustomType>,
    params: UsageLogQueryParams
) => {
    const range = "24h";
    const requestedPage = Math.min(Math.max(Number(params.page || 1) || 1, 1), 1000);
    const dimension = (params.dimension && params.dimension in LOG_FILTER_COLUMNS
        ? params.dimension : "token") as UsageLogFilterDimension;
    const keyword = params.keyword?.trim();
    const result = params.result === "success" || params.result === "failure" ? params.result : "all";

    const baseResponse = {
        sampled: true,
        dimension,
        keyword: keyword || "",
        result,
        startTime: params.start || "",
        endTime: params.end || "",
        compatibilityWarning: undefined,
    };


    const db = getDb(c);

    const buildWhere = (): { sql: string; params: unknown[] } => {
        const clauses: string[] = [];
        const bindParams: unknown[] = [];

        // 时间过滤: 支持 start/end (ISO) 或默认 24h
        if (params.start) {
            const startSec = Math.floor(new Date(params.start).getTime() / 1000);
            if (!Number.isNaN(startSec)) { clauses.push("timestamp >= ?"); bindParams.push(startSec); }
        }
        if (params.end) {
            const endSec = Math.floor(new Date(params.end).getTime() / 1000);
            if (!Number.isNaN(endSec)) { clauses.push("timestamp < ?"); bindParams.push(endSec); }
        }
        if (clauses.length === 0) {
            clauses.push("timestamp >= ?");
            bindParams.push(Math.floor(Date.now() / 1000) - 24 * 3600);
        }

        if (keyword) {
            clauses.push(`${LOG_FILTER_COLUMNS[dimension]} LIKE ?`);
            bindParams.push(`%${keyword}%`);
        }
        if (result !== "all") {
            clauses.push(`result = ?`);
            bindParams.push(result);
        }

        return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params: bindParams };
    };

    const where = buildWhere();
    const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM usage_record ${where.sql}`).bind(...where.params).first<Record<string, unknown>>();
    const total = toNumber(countRow?.total);
    const totalPages = total > 0 ? Math.ceil(total / USAGE_LOG_PAGE_SIZE) : 0;
    const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
    const offset = (page - 1) * USAGE_LOG_PAGE_SIZE;

    if (total === 0) {
        return { ...baseResponse, page, pageSize: USAGE_LOG_PAGE_SIZE, total, totalPages, count: 0, hasPrevPage: false, hasNextPage: false, items: [] };
    }

    const rows = await db.prepare(
        `SELECT * FROM usage_record ${where.sql} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`
    ).bind(...where.params, USAGE_LOG_PAGE_SIZE, offset).all<Record<string, unknown>>();

    return {
        ...baseResponse,
        page,
        pageSize: USAGE_LOG_PAGE_SIZE,
        total,
        totalPages,
        count: rows.results.length,
        hasPrevPage: totalPages > 0 && page > 1,
        hasNextPage: totalPages > 0 && page < totalPages,
        items: rows.results.map(mapEventRow),
    };
};