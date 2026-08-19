import { Context } from "hono";

import type { D1Like } from "../storage/sqlite";
import { getPricingMap, computeModelSplitCost, matchPricing } from "./pricing-cost";

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

export type AnalyticsRange = "24h" | "7d" | "30d";
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
};

const RANGE_BUCKET_SECONDS: Record<AnalyticsRange, number> = {
    "24h": 3600,
    "7d": 24 * 3600,
    "30d": 24 * 3600,
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
    // 数据保留上限 30 天; 请求 90d/无效值均落到 30d (90d 数据已清理)
    if (requested === "30d") return "30d";
    if (requested === "7d") return "7d";
    if (requested === "24h") return "24h";
    return "30d";
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
    const db = getDb(c);
    // 按 requested_model 分组取 tokens, JS 里用当前定价实时算 cost
    const rows = await db.prepare(
        `SELECT requested_model AS model,
                COUNT(*) AS requests,
                SUM(success_flag) AS successes,
                SUM(total_tokens) AS total_tokens,
                SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens,
                SUM(cached_tokens) AS cached_tokens,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
         FROM usage_record WHERE timestamp >= ?${tokenFilter.clause}
         GROUP BY requested_model`
    ).bind(startSec, ...tokenFilter.params).all<Record<string, unknown>>();

    const pricingMap = await getPricingMap(c);
    let requests = 0, successes = 0, promptTokens = 0, completionTokens = 0, cachedTokens = 0, totalTokens = 0, totalCost = 0, latencySum = 0, latencyCount = 0;

    for (const row of rows.results || []) {
        const r = toNumber(row.requests);
        const s = toNumber(row.successes);
        const pt = toNumber(row.prompt_tokens);
        const ct = toNumber(row.completion_tokens);
        const ct2 = toNumber(row.cached_tokens);
        const split = computeModelSplitCost(
            matchPricing(pricingMap, toText(row.model)),
            pt, ct, ct2
        );
        requests += r;
        successes += s;
        promptTokens += pt;
        completionTokens += ct;
        cachedTokens += ct2;
        totalTokens += toNumber(row.total_tokens);
        totalCost += split.totalCost;
        latencySum += toNumber(row.avg_latency_ms) * r;
        latencyCount += r;
    }

    const avgLatencyMs = latencyCount > 0 ? latencySum / latencyCount : 0;

    return {
        range,
        totals: {
            requests,
            successes,
            failures: Math.max(0, requests - successes),
            successRate: requests > 0 ? successes / requests : 0,
            totalCost,
            totalTokens,
            promptTokens,
            completionTokens,
            avgLatencyMs,
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
    // 按 (bucket, requested_model) 分组取 tokens
    const rows = await db.prepare(
        `SELECT FLOOR(timestamp / ?) * ? AS bucket_ts, requested_model AS model,
                COUNT(*) AS requests, SUM(success_flag) AS successes,
                SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,
                SUM(cached_tokens) AS cached_tokens
         FROM usage_record WHERE timestamp >= ? AND timestamp < ?${tokenFilter.clause}
         GROUP BY bucket_ts, requested_model ORDER BY bucket_ts ASC`
    ).bind(bucketSize, bucketSize, startSec, endSec, ...tokenFilter.params).all<Record<string, unknown>>();

    const pricingMap = await getPricingMap(c);
    // 每 bucket 累计 requests/successes/cost
    const acc = new Map<number, { requests: number; successes: number; totalCost: number }>();
    for (const row of rows.results || []) {
        const bt = toNumber(row.bucket_ts);
        const cur = acc.get(bt) || { requests: 0, successes: 0, totalCost: 0 };
        const r = toNumber(row.requests);
        const split = computeModelSplitCost(
            matchPricing(pricingMap, toText(row.model)),
            toNumber(row.prompt_tokens), toNumber(row.completion_tokens), toNumber(row.cached_tokens)
        );
        cur.requests += r;
        cur.successes += toNumber(row.successes);
        cur.totalCost += split.totalCost;
        acc.set(bt, cur);
    }

    return {
        range,
        bucket: range === "24h" ? "1h" : "1d",
        points: bucketTimestamps.map((bucketTimestamp) => {
            const row = acc.get(bucketTimestamp) || { requests: 0, successes: 0, totalCost: 0 };
            const requests = row.requests;
            const successes = row.successes;
            return {
                timestamp: new Date(bucketTimestamp * 1000).toISOString(),
                requests,
                successes,
                failures: Math.max(0, requests - successes),
                successRate: requests > 0 ? successes / requests : 0,
                totalCost: row.totalCost,
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
    // 按 (label, requested_model) 二级分组, 区间末按 label 合并并实时算 cost
    const rows = await db.prepare(
        `SELECT ${column} AS label, requested_model AS model,
                COUNT(*) AS requests, SUM(success_flag) AS successes,
                SUM(total_tokens) AS total_tokens, SUM(prompt_tokens) AS prompt_tokens,
                SUM(completion_tokens) AS completion_tokens, SUM(cached_tokens) AS cached_tokens,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
         FROM usage_record WHERE timestamp >= ? AND ${column} != ''${tokenFilter.clause}
         GROUP BY label, requested_model`
    ).bind(startSec, ...tokenFilter.params).all<Record<string, unknown>>();

    const pricingMap = await getPricingMap(c);
    const labelAcc = new Map<string, {
        requests: number; successes: number; totalTokens: number;
        promptTokens: number; completionTokens: number; latencySum: number; chargeCount: number; totalCost: number;
    }>();

    for (const row of rows.results || []) {
        const label = toText(row.label);
        const cur = labelAcc.get(label) || {
            requests: 0, successes: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
            latencySum: 0, chargeCount: 0, totalCost: 0,
        };
        const r = toNumber(row.requests);
        const split = computeModelSplitCost(
            matchPricing(pricingMap, toText(row.model)),
            toNumber(row.prompt_tokens), toNumber(row.completion_tokens), toNumber(row.cached_tokens)
        );
        cur.requests += r;
        cur.successes += toNumber(row.successes);
        cur.totalTokens += toNumber(row.total_tokens);
        cur.promptTokens += toNumber(row.prompt_tokens);
        cur.completionTokens += toNumber(row.completion_tokens);
        cur.latencySum += toNumber(row.avg_latency_ms) * r;
        cur.chargeCount += r;
        cur.totalCost += split.totalCost;
        labelAcc.set(label, cur);
    }

    const items = [...labelAcc.entries()].map(([label, cur]) => {
        const requests = cur.requests;
        const successes = cur.successes;
        return {
            label,
            requests,
            successes,
            failures: Math.max(0, requests - successes),
            successRate: requests > 0 ? successes / requests : 0,
            totalCost: cur.totalCost,
            totalTokens: cur.totalTokens,
            promptTokens: cur.promptTokens,
            completionTokens: cur.completionTokens,
            avgLatencyMs: cur.chargeCount > 0 ? cur.latencySum / cur.chargeCount : 0,
        };
    }).sort((a, b) => {
        if (b.requests !== a.requests) return b.requests - a.requests;
        return b.totalCost - a.totalCost;
    }).slice(0, 12);

    return {
        range,
        dimension,
        items,
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
    params: UsageLogQueryParams & { tokenHashes?: string[] }
) => {
    const range = "24h";
    const requestedPage = Math.min(Math.max(Number(params.page || 1) || 1, 1), 1000);
    const dimension = (params.dimension && params.dimension in LOG_FILTER_COLUMNS
        ? params.dimension : "token") as UsageLogFilterDimension;
    const keyword = params.keyword?.trim();
    const result = params.result === "success" || params.result === "failure" ? params.result : "all";
    const tokenHashes = params.tokenHashes;

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

        // 令牌过滤: 用户自助日志 (仅自己的令牌)
        if (tokenHashes && tokenHashes.length > 0) {
            const placeholders = tokenHashes.map(() => "?").join(",");
            clauses.push(`token_hash IN (${placeholders})`);
            bindParams.push(...tokenHashes);
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