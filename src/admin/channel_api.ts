import { Context } from "hono"
import { contentJson, OpenAPIRoute } from 'chanfana';
import { z } from 'zod';

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import {
    DEFAULT_CLAUDE_API_VERSION,
    type NormalizedChannelConfig,
    normalizeChannelConfig,
    sanitizeChannelConfig,
} from "../channel-config";
import { buildAzureTargetUrlFromPath } from "../providers/shared/azure-target-url";
import { buildPrefixedTargetUrl } from "../providers/shared/prefixed-target-url";

const ChannelModelSchema = z.object({
    id: z.string().describe('Upstream model ID'),
    name: z.string().describe('External model name exposed by this proxy'),
    enabled: z.boolean().optional().describe('Whether this model is available for routing'),
    default_params: z.record(z.string(), z.unknown()).optional().describe('Default request parameters applied when callers do not provide them'),
});

const parseFetchedModels = (payload: any): ChannelModelMapping[] => {
    const rawModels = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.models)
                ? payload.models
                : [];

    const normalizedModels: ChannelModelMapping[] = [];
    const seenIds = new Set<string>();

    for (const rawModel of rawModels) {
        if (typeof rawModel === "string") {
            const id = rawModel.trim();
            if (!id || seenIds.has(id)) {
                continue;
            }
            seenIds.add(id);
            normalizedModels.push({ id, name: id, enabled: true });
            continue;
        }

        if (!rawModel || typeof rawModel !== "object") {
            continue;
        }

        const id = (
            typeof rawModel.id === "string" ? rawModel.id
                : typeof rawModel.model === "string" ? rawModel.model
                    : typeof rawModel.name === "string" ? rawModel.name
                        : ""
        ).trim();

        if (!id || seenIds.has(id)) {
            continue;
        }

        const name = (
            typeof rawModel.display_name === "string" ? rawModel.display_name
                : typeof rawModel.name === "string" ? rawModel.name
                    : id
        ).trim() || id;

        seenIds.add(id);
        normalizedModels.push({ id, name: name || id, enabled: true });
    }

    return normalizedModels;
};

const buildModelsFetchRequest = (
    config: NormalizedChannelConfig,
    apiKey: string
): Request => {
    let targetUrl: URL;
    const headers = new Headers({
        "Accept": "application/json",
    });

    switch (config.type) {
        case "azure-openai":
        case "azure-openai-audio":
        case "azure-openai-responses":
            targetUrl = buildAzureTargetUrlFromPath(config.endpoint, "/v1/models");
            headers.set("api-key", apiKey);
            break;
        case "claude":
            targetUrl = buildPrefixedTargetUrl(config.endpoint, "/v1/models");
            headers.set("x-api-key", apiKey);
            headers.set("anthropic-version", DEFAULT_CLAUDE_API_VERSION);
            break;
        case "openai":
        case "gemini":
        case "openai-audio":
        case "openai-responses":
        case "claude-to-openai":
        default:
            targetUrl = buildPrefixedTargetUrl(config.endpoint, "/v1/models", "/v1", config.type);
            headers.set("Authorization", `Bearer ${apiKey}`);
            break;
    }

    return new Request(targetUrl, {
        method: "GET",
        headers,
    });
};

const fetchModelsFromChannel = async (
    config: ChannelConfig
): Promise<ChannelModelMapping[]> => {
    const normalizedConfig = normalizeChannelConfig(config);

    if (!normalizedConfig.endpoint || !normalizedConfig.type) {
        throw new Error("Channel endpoint and type are required");
    }

    if (normalizedConfig.api_keys.length === 0) {
        // 免 Key 渠道(如 OpenCode / Kilo Gateway):使用默认 public Bearer 拉取上游模型
        const response = await fetch(buildModelsFetchRequest(normalizedConfig, "public"));
        if (!response.ok) {
            throw new Error(`Failed to fetch models from upstream (${response.status})`);
        }
        const responseJson = await response.json();
        return parseFetchedModels(responseJson);
    }

    let lastError = "Failed to fetch models from upstream";

    for (const apiKey of normalizedConfig.api_keys) {
        const response = await fetch(buildModelsFetchRequest(normalizedConfig, apiKey));

        if (!response.ok) {
            const errorText = await response.text();
            lastError = errorText || `Upstream returned ${response.status}`;
            continue;
        }

        const responseJson = await response.json();
        return parseFetchedModels(responseJson);
    }

    throw new Error(lastError);
};

// 获取所有 Channel 配置
export class ChannelGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Get all channel configurations',
        responses: {
            ...CommonSuccessfulResponse(z.array(z.object({
                key: z.string(),
                value: z.string(),
                created_at: z.string(),
                updated_at: z.string(),
            }))),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const result = await c.env.DB.prepare(
            `SELECT * FROM channel_config
             ORDER BY
             COALESCE(CAST(json_extract(value, '$.weight') AS INTEGER), 0) DESC,
             datetime(created_at) DESC,
             key ASC`
        ).all<ChannelConfigRow>();

        return {
            success: true,
            data: result.results
        } as CommonResponse;
    }
}

// 创建或更新 Channel 配置
export class ChannelUpsertEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Create or update channel configuration',
        request: {
            params: z.object({
                key: z.string().describe('Channel key'),
            }),
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().describe('Channel name'),
                            type: z.string().describe('Channel type'),
                            endpoint: z.string().describe('API endpoint'),
                            enabled: z.boolean().optional().describe('Whether this channel participates in request routing'),
                            weight: z.number().int().min(0).max(5).optional().describe('Priority weight for channel routing'),
                            api_key: z.string().optional().describe('Deprecated single API key'),
                            api_keys: z.array(z.string()).optional().describe('API keys, one request will pick one randomly'),
                            auto_retry: z.boolean().optional().describe('Automatically retry the channel up to 3 times on retryable failures'),
                            auto_rotate: z.boolean().optional().describe('When retrying, randomly rotate to other API keys in the same channel'),
                            models: z.array(ChannelModelSchema).optional().describe('External model name to upstream model ID mappings'),
                            supported_models: z.array(z.string()).optional().describe('Deprecated supported request model list'),
                            deployment_mapper: z.record(z.string(), z.string()).optional().describe('Deprecated model deployment mapping'),
                            model_pricing: z.record(z.string(), z.object({
                                billingMode: z.enum(["volume", "request"]).optional().describe('Billing mode: volume = per 1M tokens, request = fixed per successful response'),
                                input: z.number().optional().describe('Input price: per 1M tokens in volume mode, fixed per success in request mode'),
                                output: z.number().optional().describe('Output price: per 1M tokens in volume mode, fixed per success in request mode'),
                                cache: z.number().optional().describe('Cache price: per 1M cached tokens in volume mode, fixed when cache is used in request mode'),
                                request: z.number().optional().describe('Legacy fixed request price, kept for backward compatibility'),
                            })).optional().describe('Custom model pricing for this channel'),
                        }),
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const { key } = c.req.param();
        const rawConfig = await c.req.json<ChannelConfig>();
        const config = sanitizeChannelConfig(rawConfig);

        if (!config.name || !config.endpoint) {
            return c.text('Channel name and endpoint are required', 400);
        }

        // 允许空 API key(免 Key 渠道,如 OpenCode / Kilo Gateway 等免费代理)

        // Upsert channel config directly using SQL
        // excluded.value 指的是 INSERT 语句中要插入的新值
        // 当发生冲突时，用新值更新现有记录
        const result = await c.env.DB.prepare(
            `INSERT INTO channel_config (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = datetime('now')`
        ).bind(key, JSON.stringify(config)).run();

        if (!result.success) {
            return c.text('Failed to upsert channel config', 500);
        }

        return {
            success: true,
            data: true
        } as CommonResponse;
    }
}

// 判断是否为免费模型:ID 以 -free 或 :free 结尾,或为 kilo-auto/free 等聚合免费入口
const isFreeModelId = (modelId: string): boolean => {
    const id = modelId.toLowerCase();
    return id.endsWith(":free") || id.endsWith("-free") || id.includes("/free");
};

// 过滤出免费模型列表
const filterFreeModels = (models: ChannelModelMapping[]): ChannelModelMapping[] => {
    return models.filter((model) => isFreeModelId(model.id));
};

export class ChannelFetchModelsEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Fetch upstream model list for a channel config',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().optional(),
                            type: z.string().optional(),
                            endpoint: z.string().optional(),
                            enabled: z.boolean().optional(),
                            weight: z.number().int().min(0).max(5).optional(),
                            api_key: z.string().optional(),
                            api_keys: z.array(z.string()).optional(),
                            auto_retry: z.boolean().optional(),
                            auto_rotate: z.boolean().optional(),
                            models: z.array(ChannelModelSchema).optional(),
                            supported_models: z.array(z.string()).optional(),
                            deployment_mapper: z.record(z.string(), z.string()).optional(),
                            free_only: z.boolean().optional().describe("Only return free models (ids ending in -free or :free)"),
                            model_pricing: z.record(z.string(), z.object({
                                billingMode: z.enum(["volume", "request"]).optional(),
                                input: z.number().optional(),
                                output: z.number().optional(),
                                cache: z.number().optional(),
                                request: z.number().optional(),
                            })).optional(),
                        }),
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(z.array(ChannelModelSchema)),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const rawBody = await c.req.json<ChannelConfig & { free_only?: boolean }>();
        const rawConfig = rawBody as ChannelConfig;
        const freeOnly = Boolean(rawBody.free_only);

        try {
            let models = await fetchModelsFromChannel(rawConfig);
            if (freeOnly) {
                models = filterFreeModels(models);
            }
            return {
                success: true,
                data: models,
            } as CommonResponse;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to fetch models";
            return c.text(message, 502);
        }
    }
}

// 测试 Channel 模型连通性 (服务端代理, 避免 CORS; ai-gateway 移植)
export class ChannelTestModelEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Test a model connection through the channel (server-side proxy)',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string().optional(),
                            type: z.string().optional(),
                            endpoint: z.string().optional(),
                            api_key: z.string().optional(),
                            api_keys: z.array(z.string()).optional(),
                            mirrors: z.array(z.string()).optional(),
                            model: z.string().describe('Model id to test'),
                            message: z.string().optional().describe('Test prompt (default: hi)'),
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
        const body = await c.req.json<Partial<ChannelConfig> & { model: string; message?: string }>();
        const model = body.model;
        if (!model) {
            return c.text("model is required", 400);
        }

        const rawConfig: ChannelConfig = {
            name: body.name || "test",
            type: (body.type || "openai") as ChannelType,
            endpoint: body.endpoint || "",
            api_key: body.api_key,
            api_keys: body.api_keys || (body.api_key ? [body.api_key] : []),
            mirrors: body.mirrors,
        };

        if (!rawConfig.endpoint) {
            return c.text("endpoint is required", 400);
        }

        // 服务端向渠道发最小 chat/completions 请求 (含 mirrors 故障转移)
        const testPrompt = body.message || "hi";
        const apiKeys = rawConfig.api_keys?.length ? rawConfig.api_keys : ["public"];
        const allEndpoints = [rawConfig.endpoint, ...(rawConfig.mirrors || [])];
        let lastError: string | null = null;

        for (const endpoint of allEndpoints) {
            for (const apiKey of apiKeys) {
                try {
                    const targetUrl = buildPrefixedTargetUrl(endpoint, "/chat/completions", "/v1", rawConfig.type);
                    const headers = new Headers({ "Content-Type": "application/json" });
                    headers.set("Authorization", `Bearer ${apiKey}`);
                    const response = await fetch(targetUrl, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            model,
                            messages: [{ role: "user", content: testPrompt }],
                            max_tokens: 8,
                            stream: false,
                        }),
                        signal: AbortSignal.timeout(60000),
                    });
                    if (response.ok) {
                        const data = await response.json().catch(() => ({}));
                        return {
                            success: true,
                            data: { ok: true, endpoint, model, status: response.status, usage: (data as any)?.usage || null },
                        } as CommonResponse;
                    }
                    lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
                } catch (error) {
                    lastError = error instanceof Error ? error.message : String(error);
                }
            }
        }

        return c.text(lastError || "All endpoints failed", 502);
    }
}

// 删除 Channel 配置
export class ChannelDeleteEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Delete channel configuration',
        request: {
            params: z.object({
                key: z.string().describe('Channel key'),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const { key } = c.req.param();

        // Delete channel config directly using SQL
        const result = await c.env.DB.prepare(
            `DELETE FROM channel_config WHERE key = ?`
        ).bind(key).run();

        return {
            success: true,
            data: result.success
        } as CommonResponse;
    }
}
