import { Context } from "hono";
import { BILLING_RAW_SCALE } from "../billing";

export const DEFAULT_USAGE_ANALYTICS_DATASET_NAME = "usage_events_by_token";

export type UsageLogContext = {
    routeId: string;
    tokenHash: string;
    tokenName: string;
    channelKey: string;
    providerType: string;
    requestedModel: string;
    upstreamModel: string;
    streamMode: "stream" | "sync";
    requestId: string;
    traceId: string;
    clientIp: string;
    userAgent: string;
    country: string;
    region: string;
    city: string;
    colo: string;
    timezone: string;
    startedAt: number;
    trackingState: RequestTrackingState;
}

type UsageCostResult = {
    totalCost: number;
    cacheCost: number;
}

type FailureLogParams = {
    errorCode: string;
    errorSummary?: string;
}

const MAX_DIMENSION_LENGTH = 200;

const safeNumber = (value: unknown): number => {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const normalizeDimension = (value: unknown): string => {
    if (typeof value !== "string") {
        return "";
    }

    return value.slice(0, MAX_DIMENSION_LENGTH);
};

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return "";
};

const getStatusFamily = (status?: number): string => {
    if (!status || status < 100) {
        return "network";
    }

    return `${Math.floor(status / 100)}xx`;
};

const getDatasetName = (c: Context<HonoCustomType>): string => {
    return c.env.USAGE_ANALYTICS_DATASET || DEFAULT_USAGE_ANALYTICS_DATASET_NAME;
};

const getAnalyticsBinding = (c: Context<HonoCustomType>): AnalyticsEngineDataset | null => {
    if (!c.env.USAGE_ANALYTICS || !getDatasetName(c)) {
        return null;
    }

    return c.env.USAGE_ANALYTICS;
};

// 统一数据库分析模式: 只要存在 DB (D1 或本地 SQLite/MySQL/PG), 用量记录就写入 usage_record 表。
// 不再依赖 Cloudflare Analytics Engine (CF Worker/Pages 部署同样使用 D1 作为分析数据源)。
export const isLocalDbAnalyticsMode = (c: Context<HonoCustomType>): boolean => {
    if (!c.env.DB || typeof (c.env.DB as any).prepare !== "function") {
        return false;
    }

    return true;
};

const writeLocalDbDataPoint = (
    c: Context<HonoCustomType>,
    point: AnalyticsEngineDataPoint
): void => {
    if (!isLocalDbAnalyticsMode(c)) {
        return;
    }

    const blobs = point.blobs || [];
    const doubles = point.doubles || [];
    const timestamp = Math.floor(Date.now() / 1000);

    const blobValue = (index: number): string => {
        const value = blobs[index];
        return typeof value === "string" ? value.slice(0, 200) : "";
    };

    const doubleValue = (index: number): number => {
        const value = doubles[index];
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };

    const insertSql = `INSERT INTO usage_record (
        timestamp, route_id, token_hash, token_name, channel_key, provider_type,
        requested_model, upstream_model, result, stream_mode, error_code, status_family,
        request_id, trace_id, client_ip, user_agent, country, region, city, colo, timezone, error_summary,
        prompt_tokens, completion_tokens, cached_tokens, total_tokens, total_cost, cache_cost,
        latency_ms, retry_count, upstream_status, success_flag, billing_scale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const db = (c.env.DB as any);
    try {
        // Workers 环境下响应返回后会冻结事件循环, 必须用 waitUntil 挂起异步 D1 写入,
        // 否则用量记录会在请求结束后被丢弃 (表现为调用成功但看板为空)。
        const writePromise = db.prepare(insertSql).bind(
            timestamp,
            blobValue(0),   // routeId
            (point.indexes && point.indexes[0]) || "",
            blobValue(1),   // tokenName
            blobValue(2),   // channelKey
            blobValue(3),   // providerType
            blobValue(4),   // requestedModel
            blobValue(5),   // upstreamModel
            blobValue(6),   // result
            blobValue(7),   // streamMode
            blobValue(8),   // errorCode
            blobValue(9),   // statusFamily
            blobValue(10),  // requestId
            blobValue(11),  // traceId
            blobValue(12),  // clientIp
            blobValue(13),  // userAgent
            blobValue(14),  // country
            blobValue(15),  // region
            blobValue(16),  // city
            blobValue(17),  // colo
            blobValue(18),  // timezone
            blobValue(19),  // errorSummary
            doubleValue(0),  // promptTokens
            doubleValue(1),  // completionTokens
            doubleValue(2),  // cachedTokens
            doubleValue(3),  // totalTokens
            doubleValue(4),  // totalCost
            doubleValue(10), // cacheCost (index 10)
            doubleValue(5),  // latencyMs
            doubleValue(6),  // retryCount
            doubleValue(7),  // upstreamStatus
            doubleValue(8),  // successFlag
            doubleValue(9),  // billingScale
        ).run().catch((error: unknown) => {
            console.error("Failed to write local usage record:", error);
        });

        const executionCtx = (c as any).executionCtx;
        if (executionCtx && typeof executionCtx.waitUntil === "function") {
            executionCtx.waitUntil(writePromise);
        }
    } catch (error) {
        console.error("Failed to write local usage record:", error);
    }
};

const writeDataPoint = (
    c: Context<HonoCustomType>,
    point: AnalyticsEngineDataPoint
) => {
    // 本地数据库模式优先
    if (isLocalDbAnalyticsMode(c)) {
        writeLocalDbDataPoint(c, point);
        return;
    }

    const binding = getAnalyticsBinding(c);
    if (!binding) {
        return;
    }

    try {
        binding.writeDataPoint(point);
    } catch (error) {
        console.error("Failed to write usage analytics datapoint:", error);
    }
};

const extractSummaryFromUnknown = (value: unknown): string => {
    if (typeof value === "string") {
        return normalizeDimension(value.replace(/\s+/g, " ").trim());
    }

    if (value && typeof value === "object") {
        const candidateRecord = value as Record<string, unknown>;
        for (const key of ["message", "error", "detail", "description", "reason", "title"]) {
            const candidateValue = candidateRecord[key];
            if (typeof candidateValue === "string" && candidateValue.trim()) {
                return normalizeDimension(candidateValue.replace(/\s+/g, " ").trim());
            }
            if (candidateValue && typeof candidateValue === "object") {
                const nested = extractSummaryFromUnknown(candidateValue);
                if (nested) {
                    return nested;
                }
            }
        }
    }

    return "";
};

export const summarizeErrorText = (text: string): string => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }

    try {
        const parsed = JSON.parse(normalized) as unknown;
        const summary = extractSummaryFromUnknown(parsed);
        if (summary) {
            return summary;
        }
    } catch {
        // ignore JSON parse errors and fallback to plain text
    }

    return normalizeDimension(normalized);
};

export const summarizeErrorFromResponse = async (response: Response): Promise<string> => {
    try {
        const text = await response.clone().text();
        return summarizeErrorText(text);
    } catch {
        return "";
    }
};

export const summarizeErrorFromUnknown = (error: unknown): string => {
    if (error instanceof Error) {
        return summarizeErrorText(error.message);
    }

    return summarizeErrorText(String(error ?? ""));
};

export const buildUsageRequestMetadata = (c: Context<HonoCustomType>) => {
    const requestCf = (c.req.raw.cf || {}) as Partial<IncomingRequestCfProperties<unknown>>;
    const requestId = firstNonEmpty(
        c.req.header("x-request-id"),
        c.req.header("cf-ray"),
        crypto.randomUUID()
    );
    const traceId = firstNonEmpty(
        c.req.header("traceparent"),
        c.req.header("x-b3-traceid"),
        c.req.header("x-trace-id"),
        requestId
    );

    return {
        requestId,
        traceId,
        clientIp: firstNonEmpty(
            c.req.header("cf-connecting-ip"),
            c.req.header("x-real-ip"),
            c.req.header("x-forwarded-for")?.split(",")[0]
        ),
        userAgent: firstNonEmpty(c.req.header("user-agent")),
        country: firstNonEmpty(requestCf.country),
        region: firstNonEmpty(requestCf.region, requestCf.regionCode),
        city: firstNonEmpty(requestCf.city),
        colo: firstNonEmpty(requestCf.colo),
        timezone: firstNonEmpty(requestCf.timezone),
    };
};

const buildCommonPoint = (
    context: UsageLogContext,
    usage: Usage,
    costResult: UsageCostResult,
    result: "success" | "failure",
    errorCode: string,
    errorSummary: string
): AnalyticsEngineDataPoint => {
    const promptTokens = safeNumber(usage.prompt_tokens);
    const completionTokens = safeNumber(usage.completion_tokens);
    const cachedTokens = safeNumber(usage.cached_tokens);
    const totalTokens = safeNumber(
        usage.total_tokens ?? (promptTokens + completionTokens)
    );
    const upstreamStatus = safeNumber(context.trackingState.upstreamStatus);

    return {
        indexes: [context.tokenHash],
        blobs: [
            normalizeDimension(context.routeId),
            normalizeDimension(context.tokenName),
            normalizeDimension(context.channelKey),
            normalizeDimension(context.providerType),
            normalizeDimension(context.requestedModel),
            normalizeDimension(context.upstreamModel),
            result,
            context.streamMode,
            normalizeDimension(errorCode),
            getStatusFamily(upstreamStatus),
            normalizeDimension(context.requestId),
            normalizeDimension(context.traceId),
            normalizeDimension(context.clientIp),
            normalizeDimension(context.userAgent),
            normalizeDimension(context.country),
            normalizeDimension(context.region),
            normalizeDimension(context.city),
            normalizeDimension(context.colo),
            normalizeDimension(context.timezone),
            normalizeDimension(errorSummary),
        ],
        doubles: [
            promptTokens,
            completionTokens,
            cachedTokens,
            totalTokens,
            safeNumber(costResult.totalCost),
            Math.max(0, Date.now() - context.startedAt),
            safeNumber(context.trackingState.retryCount),
            upstreamStatus,
            result === "success" ? 1 : 0,
            BILLING_RAW_SCALE,
            safeNumber(costResult.cacheCost),
        ],
    };
};

export const writeUsageSuccessEvent = (
    c: Context<HonoCustomType>,
    context: UsageLogContext,
    usage: Usage,
    costResult: UsageCostResult
) => {
    writeDataPoint(c, buildCommonPoint(context, usage, costResult, "success", "", ""));
};

export const writeUsageFailureEvent = (
    c: Context<HonoCustomType>,
    context: UsageLogContext,
    params: FailureLogParams
) => {
    writeDataPoint(
        c,
        buildCommonPoint(
            context,
            {},
            {
                totalCost: 0,
                cacheCost: 0,
            },
            "failure",
            params.errorCode,
            params.errorSummary || context.trackingState.errorSummary || ""
        )
    );
};

export const hashTokenKey = async (value: string): Promise<string> => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((part) => part.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
};
