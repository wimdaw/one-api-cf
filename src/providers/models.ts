import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { getApiKeyFromHeaders, fetchTokenData, fetchChannelsForToken } from "./shared/auth";
import { getChannelModels, getJsonSetting } from "../utils";
import { normalizeChannelConfig } from "../channel-config";
import { TokenUtils } from "../admin/token_utils";
import { CONSTANTS } from "../constants";

// 模型列表内存缓存 (Workers 单实例内生效)。
// 同一 token 的 channel_keys 不变时, 模型列表结果相同, 无需每次查 D1。
const MODELS_CACHE_TTL_MS = 60_000;
const modelsCache = new Map<string, { expiresAt: number; json: unknown }>();

// 全量失效: 渠道/定价配置变更时调用 (admin channel_api / pricing_api)
export const invalidateModelsCache = () => {
    modelsCache.clear();
};

export class ModelsEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['OpenAI Proxy'],
        summary: 'List available models',
        request: {
            headers: z.object({
                'Authorization': z.string().optional().describe("Token for authentication (OpenAI format)"),
                'x-api-key': z.string().optional().describe("API key for authentication (Claude format)"),
            }),
        },
        responses: {
            200: {
                description: 'List of available models',
                content: {
                    'application/json': {
                        schema: z.object({
                            object: z.string(),
                            data: z.array(z.object({
                                id: z.string(),
                                object: z.string(),
                                created: z.number(),
                                owned_by: z.string(),
                            })),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const apiKey = getApiKeyFromHeaders(c);
        if (!apiKey) {
            return c.json({ object: "list", data: [] });
        }

        // 校验 token(轻量, 查库) 后构造缓存键
        const tokenInfo = await fetchTokenData(c, apiKey);
        if (!tokenInfo) {
            return c.text("Invalid API key", 401);
        }
        const channelKeys = Array.isArray(tokenInfo.tokenData.channel_keys)
            ? [...tokenInfo.tokenData.channel_keys].sort()
            : [];

        // 内存缓存命中则直接返回 (同一 token + 同样渠道, 60s 内结果不变)
        const cacheKey = `tk:${apiKey}:ch:${channelKeys.join(",")}`;
        const now = Date.now();
        const cached = modelsCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return c.json(cached.json);
        }

        const channelsResult = await fetchChannelsForToken(c, tokenInfo.tokenData);

        if (!channelsResult || !channelsResult.results || channelsResult.results.length === 0) {
            const empty = { object: "list" as const, data: [] };
            modelsCache.set(cacheKey, { expiresAt: now + MODELS_CACHE_TTL_MS, json: empty });
            return c.json(empty);
        }

        const modelsSet = new Set<string>();
        const hasRemainingQuota = TokenUtils.hasRemainingQuota(tokenInfo.tokenData.total_quota, tokenInfo.usage);
        // 一次性读取全局定价，避免循环内对每个模型重复查询
        const globalPricing = hasRemainingQuota
            ? null
            : await getJsonSetting<Record<string, ModelPricing>>(c, CONSTANTS.MODEL_PRICING_KEY);

        for (const row of channelsResult.results) {
            let config: ChannelConfig;

            try {
                config = normalizeChannelConfig(JSON.parse(row.value) as ChannelConfig);
            } catch (error) {
                console.error(`Invalid channel config for key: ${row.key}`, error);
                continue;
            }

            if (!config.enabled) {
                continue;
            }
            for (const model of getChannelModels(config)) {
                if (!hasRemainingQuota && await TokenUtils.modelRequiresPaidQuota(c, model.name, config, globalPricing)) {
                    continue;
                }
                modelsSet.add(model.name);
            }
        }

        const models = Array.from(modelsSet).sort().map((modelId) => ({
            id: modelId,
            object: "model" as const,
            created: 1700000000,
            owned_by: "system",
        }));

        const payload = {
            object: "list" as const,
            data: models,
        };
        modelsCache.set(cacheKey, { expiresAt: now + MODELS_CACHE_TTL_MS, json: payload });
        return c.json(payload);
    }
}
