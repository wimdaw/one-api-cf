import { Context } from "hono";
import { CONSTANTS } from "../constants";
import { getJsonSetting } from "../utils";
import { calculateTokenRateCostRaw, calculateRequestCostRaw } from "../billing";

// ---------------------------------------------------------------------------
// 看板成本实时计算: 不依赖历史存储的 total_cost (很多旧记录为 0),
// 按「当前定价配置 × 实际 tokens」实时计算出美元成本(raw 内部单位)。
// 关键: 必须按 requested_model 粒度聚合, 因为不同模型定价不同。
// ---------------------------------------------------------------------------

type PricingEntry = {
    input?: number;
    output?: number;
    cache?: number;
    request?: number;
    billingMode?: string;
};

export type ModelSplitCost = {
    inputCost: number;
    outputCost: number;
    cacheCost: number;
    requestCost: number;
    totalCost: number;
};

const toFinite = (value: unknown): number => {
    const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
};

const dollarsToRaw = (value: unknown): number => {
    const n = toFinite(value);
    return Math.max(0, Math.round(n * 1_000_000_000));
};

// 缓存定价映射, 避免每行重复读 settings
let pricingCache:
    | { fetchedAt: number; map: Record<string, PricingEntry> }
    | undefined;

export const getPricingMap = async (
    c: Context<HonoCustomType>
): Promise<Record<string, PricingEntry>> => {
    // 30s 缓存
    if (pricingCache && Date.now() - pricingCache.fetchedAt < 30_000) {
        return pricingCache.map;
    }
    const raw = await getJsonSetting<Record<string, unknown>>(c, CONSTANTS.MODEL_PRICING_KEY);
    const map = (raw || {}) as Record<string, PricingEntry>;
    pricingCache = { fetchedAt: Date.now(), map };
    return map;
};

export const computeModelSplitCost = (
    pricing: PricingEntry | undefined,
    promptTokens: number,
    completionTokens: number,
    cachedTokens: number
): ModelSplitCost => {
    const billingMode = pricing?.billingMode;
    const visible = pricing?.input || pricing?.output || pricing?.cache;
    const isLegacyRequestOnly = !billingMode && !visible && Boolean(pricing?.request);

    if (!pricing) {
        return { inputCost: 0, outputCost: 0, cacheCost: 0, requestCost: 0, totalCost: 0 };
    }

    // 按次计费
    if (billingMode === "request" || isLegacyRequestOnly) {
        const inputCost = isLegacyRequestOnly
            ? calculateRequestCostRaw(pricing.request || 0)
            : calculateRequestCostRaw(pricing.input || 0);
        const outputCost = isLegacyRequestOnly
            ? 0
            : calculateRequestCostRaw(pricing.output || 0);
        const cacheCost = !isLegacyRequestOnly && cachedTokens > 0
            ? calculateRequestCostRaw(pricing.cache || 0)
            : 0;
        return { inputCost, outputCost, cacheCost, requestCost: 0, totalCost: inputCost + outputCost + cacheCost };
    }

    // 按 tokens 计费 (默认 volume)
    const inputCost = calculateTokenRateCostRaw(promptTokens, pricing.input || 0);
    const outputCost = calculateTokenRateCostRaw(completionTokens, pricing.output || 0);
    const cacheCost = cachedTokens > 0
        ? calculateTokenRateCostRaw(cachedTokens, pricing.cache || 0)
        : 0;
    const requestCost = billingMode ? 0 : calculateRequestCostRaw(pricing.request || 0);
    return { inputCost, outputCost, cacheCost, requestCost, totalCost: inputCost + outputCost + cacheCost + requestCost };
};

// 供外部(测试/校验)使用的美元换算
export const rawToUsd = rawToDollars;

// 模型名 → 定价条目匹配: 定价键为对外显示名(可能带 :free/-free 后缀或真实 id),
// 用调用模型名精确匹配, 失败则尝试去 free 后缀 / 用原始名
export const matchPricing = (
    pricingMap: Record<string, PricingEntry> | undefined,
    model: string
): PricingEntry | undefined => {
    if (!pricingMap) return undefined;
    if (pricingMap[model]) return pricingMap[model];

    const lower = model.toLowerCase();
    // 尝试去 :free / -free 后缀
    const stripped = lower.replace(/:free$/, "").replace(/-free$/, "");
    for (const key of Object.keys(pricingMap)) {
        if (key.toLowerCase() === stripped) return pricingMap[key];
    }
    // 反向: 模型名无 free 但定价键带 free(搜索含 free 的键与 stripped 相同)
    for (const key of Object.keys(pricingMap)) {
        const keyStripped = key.toLowerCase().replace(/:free$/, "").replace(/-free$/, "");
        if (keyStripped === lower || keyStripped === stripped) return pricingMap[key];
    }
    return undefined;
};

function rawToDollars(value: unknown): number {
    const n = toFinite(value);
    const d = n / 1_000_000_000;
    return Math.round(d * 1_000_000) / 1_000_000;
}

export { dollarsToRaw };