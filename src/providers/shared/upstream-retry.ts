import { Context } from "hono";

import {
    MAX_CHANNEL_FALLBACKS,
    MAX_CHANNEL_RETRIES,
    normalizeChannelConfig,
} from "../../channel-config";
import {
    summarizeErrorFromResponse,
    summarizeErrorFromUnknown,
} from "../../analytics/usage-logger";
import {
    pickHighestPriorityChannel,
    ResolvedChannelCandidate,
} from "./channel-resolver";
import {
    getProvider,
    ProviderFetch,
} from "./provider-registry";
import {
    KEY_HEALTH_MAX_FAILURES,
    KEY_HEALTH_COOLDOWN_MS,
    markKeyFailure,
    markKeySuccess,
    orderKeysByHealth,
    readKeyHealth,
    writeKeyHealth,
} from "./key-health";

const RETRYABLE_STATUS_CODES = new Set([401, 403, 408, 409, 429, 500, 502, 503, 504, 529]);

type ChannelExecutionResult = {
    response: Response
    shouldFallback: boolean
    errorCode: string
    errorSummary?: string
}

// (空) shuffleKeys 已移除: 洗牌逻辑由 orderKeysByHealth 接管

const pickRandomItem = <T>(items: T[]): T => {
    return items[Math.floor(Math.random() * items.length)];
};

const cloneRequestBody = <T>(requestBody: T): T => {
    if (requestBody == null) {
        return requestBody;
    }

    return JSON.parse(JSON.stringify(requestBody)) as T;
};

const getModelDefaultParams = (
    mapping: ChannelModelMapping
): Record<string, unknown> | null => {
    const defaultParams = mapping.default_params;
    if (!defaultParams || typeof defaultParams !== "object" || Array.isArray(defaultParams)) {
        return null;
    }

    return defaultParams;
};

const buildChannelRequestBody = (
    requestBody: any,
    channel: ResolvedChannelCandidate
) => {
    const runtimeRequestBody = cloneRequestBody(requestBody);
    if (runtimeRequestBody && typeof runtimeRequestBody === "object") {
        const defaultParams = getModelDefaultParams(channel.mapping);
        const mergedRequestBody = defaultParams
            ? {
                ...cloneRequestBody(defaultParams),
                ...runtimeRequestBody,
            }
            : runtimeRequestBody;

        mergedRequestBody.model = channel.mapping.id;
        return mergedRequestBody;
    }
    return runtimeRequestBody;
};

const shouldRetryResponse = (response: Response): boolean => {
    return RETRYABLE_STATUS_CODES.has(response.status);
};

const discardResponse = async (response: Response): Promise<void> => {
    try {
        await response.body?.cancel();
    } catch (error) {
        console.warn("Failed to cancel upstream response body:", error);
    }
};

// (空) pickInitialKey 已移除: Key 选择由 orderKeysByHealth 接管

// (空) pickRetryKey 已移除: Key 切换由 nextKey() 接管

const pickNextFallbackChannel = (
    channels: ResolvedChannelCandidate[],
    attemptedChannelKeys: Set<string>
): ResolvedChannelCandidate | null => {
    const remainingChannels = channels.filter((channel) => {
        return !attemptedChannelKeys.has(channel.key);
    });

    if (remainingChannels.length === 0) {
        return null;
    }

    return pickHighestPriorityChannel(remainingChannels);
};

const executeChannelWithRetries = async (
    c: Context<HonoCustomType>,
    channel: ResolvedChannelCandidate,
    requestBody: any,
    saveUsage: (usage: Usage) => Promise<void>,
    trackingState: RequestTrackingState,
    provider: ProviderFetch,
    rawBody?: ArrayBuffer | string,
    contentType?: string,
    isMultipart?: boolean,
): Promise<ChannelExecutionResult> => {
    const normalizedConfig = normalizeChannelConfig(channel.config);
    const apiKeys = normalizedConfig.api_keys || [];

    if (apiKeys.length === 0) {
        const errorSummary = "Channel API keys not configured";
        trackingState.upstreamStatus = 0;
        trackingState.errorSummary = errorSummary;

        return {
            response: c.text(errorSummary, 500),
            shouldFallback: true,
            errorCode: "channel_keys_missing",
            errorSummary,
        };
    }

    // 读取健康状态并按健康度排序 Key (多 Key 轮询 + 健康检查)
    const health = await readKeyHealth(c, channel.key);
    const { ordered, demotedCount, probationCount } = orderKeysByHealth(apiKeys, health);

    if (ordered.length === 0) {
        const errorSummary = "All channel API keys are in cooldown";
        trackingState.upstreamStatus = 0;
        trackingState.errorSummary = errorSummary;

        return {
            response: c.text(errorSummary, 503),
            shouldFallback: true,
            errorCode: "channel_keys_cooldown",
            errorSummary,
        };
    }

    if (demotedCount > 0 || probationCount > 0) {
        console.warn(
            `[key-health] channel "${normalizedConfig.name || channel.key}": `
            + `${demotedCount} key(s) demoted, ${probationCount} key(s) on probation`
        );
    }

    const maxAttempts = 1 + (normalizedConfig.auto_retry ? MAX_CHANNEL_RETRIES : 0);
    const usedKeys = new Set<string>();
    let currentKey = ordered[0];
    const healthDirty = { value: false };

    let attemptIndex = 0;
    let keyCursor = 0;
    let lastResponse: Response | null = null;

    const writeHealthIfDirty = async () => {
        if (healthDirty.value) {
            await writeKeyHealth(c, channel.key, health);
            healthDirty.value = false;
        }
    };

    const nextKey = (): string => {
        const remaining = ordered.slice(keyCursor).filter((key) => !usedKeys.has(key));
        if (remaining.length > 0) {
            const key = pickRandomItem(remaining);
            usedKeys.add(key);
            return key;
        }
        // 所有有序 Key 已试完; 若未达最大尝试次数则回退到任意未用 Key
        const anyUnused = apiKeys.filter((key) => !usedKeys.has(key));
        const pool = anyUnused.length > 0 ? anyUnused : apiKeys;
        const key = pickRandomItem(pool);
        usedKeys.add(key);
        return key;
    };

    while (attemptIndex < maxAttempts) {
        try {
            const runtimeConfig: ChannelConfig = {
                ...normalizedConfig,
                api_key: currentKey,
                api_keys: [currentKey],
            };

            const bodyForProvider = isMultipart
                ? {
                    __rawBody: rawBody,
                    __contentType: contentType,
                    model: channel.mapping.id,
                }
                : buildChannelRequestBody(requestBody, channel);

            const response = await provider(
                c,
                runtimeConfig,
                bodyForProvider,
                saveUsage,
                trackingState,
            );

            if (response.ok) {
                // 成功: 清除健康记录 (恢复权重)
                if (markKeySuccess(health, currentKey)) {
                    healthDirty.value = true;
                    await writeHealthIfDirty();
                }
                return {
                    response,
                    shouldFallback: false,
                    errorCode: "",
                };
            }

            // 429 限流: 跳过当前 Key, 不标记失败 (限流是临时, 不代表 Key 坏)
            if (response.status === 429) {
                lastResponse = response;
                if (attemptIndex >= maxAttempts - 1) {
                    const errorSummary = await summarizeErrorFromResponse(response);
                    trackingState.errorSummary = errorSummary;
                    return {
                        response,
                        shouldFallback: true,
                        errorCode: "http_429",
                        errorSummary,
                    };
                }
                await discardResponse(response);
                currentKey = nextKey();
                trackingState.retryCount += 1;
                attemptIndex += 1;
                continue;
            }

            // 非可重试状态 (400/404 等业务错误): 直接返回, 不换 Key 不标记健康
            if (!shouldRetryResponse(response)) {
                const errorSummary = await summarizeErrorFromResponse(response);
                trackingState.errorSummary = errorSummary;
                return {
                    response,
                    shouldFallback: false,
                    errorCode: `http_${response.status}`,
                    errorSummary,
                };
            }

            // 401/403/5xx: 标记失败并换下一个 Key
            markKeyFailure(health, currentKey);
            healthDirty.value = true;
            lastResponse = response;

            const hasNextAttempt = attemptIndex < maxAttempts - 1;
            if (!hasNextAttempt) {
                const errorSummary = await summarizeErrorFromResponse(response);
                trackingState.errorSummary = errorSummary;
                await writeHealthIfDirty();
                return {
                    response,
                    shouldFallback: true,
                    errorCode: `http_${response.status}`,
                    errorSummary,
                };
            }

            console.warn(
                `Key failover for channel "${normalizedConfig.name || channel.key}", `
                + `attempt ${attemptIndex + 1}/${maxAttempts}, status ${response.status}`
            );

            await discardResponse(response);
            currentKey = nextKey();
            trackingState.retryCount += 1;
            attemptIndex += 1;
        } catch (error) {
            const hasNextAttempt = attemptIndex < maxAttempts - 1;

            console.error(
                `Upstream request error for channel "${normalizedConfig.name || channel.key}", `
                + `attempt ${attemptIndex + 1}/${maxAttempts}`,
                error
            );

            // 网络/传输错误也标记失败
            markKeyFailure(health, currentKey);
            healthDirty.value = true;
            lastResponse = new Response(
                JSON.stringify({ error: { message: error instanceof Error ? error.message : "Upstream error", type: "proxy_error" } }),
                { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } }
            );

            if (!hasNextAttempt) {
                trackingState.upstreamStatus = 0;
                trackingState.errorSummary = summarizeErrorFromUnknown(error);
                await writeHealthIfDirty();
                const message = error instanceof Error ? error.message : "Unknown upstream error";
                return {
                    response: c.text(`Upstream request failed: ${message}`, 502),
                    shouldFallback: true,
                    errorCode: "upstream_exception",
                    errorSummary: trackingState.errorSummary,
                };
            }

            trackingState.upstreamStatus = 0;
            currentKey = nextKey();
            trackingState.retryCount += 1;
            attemptIndex += 1;
        }
    }

    await writeHealthIfDirty();
    const errorSummary = trackingState.errorSummary || "Upstream request failed after retries";
    return {
        response: lastResponse || c.text("Upstream request failed after retries", 502),
        shouldFallback: true,
        errorCode: "upstream_retries_exhausted",
        errorSummary,
    };
};

export const executeWithFallbackChannels = async (
    c: Context<HonoCustomType>,
    channels: ResolvedChannelCandidate[],
    initialChannel: ResolvedChannelCandidate,
    requestBody: any,
    saveUsage: (usage: Usage) => Promise<void>,
    logFailure: (errorCode: string, errorSummary?: string) => void,
    trackingState: RequestTrackingState,
    setActiveChannel: (channel: ResolvedChannelCandidate) => void,
    rawBody?: ArrayBuffer | string,
    contentType?: string,
    isMultipart?: boolean,
): Promise<Response> => {
    const attemptedChannelKeys = new Set<string>();
    let currentChannel = initialChannel;
    let fallbackCount = 0;

    while (true) {
        attemptedChannelKeys.add(currentChannel.key);
        setActiveChannel(currentChannel);
        trackingState.errorSummary = undefined;

        const provider = getProvider(currentChannel.config.type || "");
        if (!provider) {
            const errorSummary = "Channel type not supported";
            const response = c.text(errorSummary, 400);
            const nextChannel = fallbackCount < MAX_CHANNEL_FALLBACKS
                ? pickNextFallbackChannel(channels, attemptedChannelKeys)
                : null;

            trackingState.upstreamStatus = 0;
            trackingState.errorSummary = errorSummary;

            if (!nextChannel) {
                logFailure("channel_type_invalid", errorSummary);
                return response;
            }

            console.warn(
                `Fallback to channel "${nextChannel.key}" after unsupported provider `
                + `on channel "${currentChannel.key}"`
            );

            fallbackCount += 1;
            trackingState.retryCount += 1;
            currentChannel = nextChannel;
            continue;
        }

        const execution = await executeChannelWithRetries(
            c,
            currentChannel,
            requestBody,
            saveUsage,
            trackingState,
            provider,
            rawBody,
            contentType,
            isMultipart,
        );

        if (execution.response.ok) {
            return execution.response;
        }

        const nextChannel = execution.shouldFallback && fallbackCount < MAX_CHANNEL_FALLBACKS
            ? pickNextFallbackChannel(channels, attemptedChannelKeys)
            : null;

        if (!nextChannel) {
            logFailure(execution.errorCode, execution.errorSummary);
            return execution.response;
        }

        await discardResponse(execution.response);

        console.warn(
            `Fallback to channel "${nextChannel.key}" after channel "${currentChannel.key}" `
            + `failed for model "${currentChannel.mapping.name}"`
        );

        fallbackCount += 1;
        trackingState.retryCount += 1;
        currentChannel = nextChannel;
    }
};
