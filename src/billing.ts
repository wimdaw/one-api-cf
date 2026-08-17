export const BILLING_RAW_SCALE = 1_000_000_000;
export const LEGACY_BILLING_SCALE = 1_000_000;
export const LEGACY_TO_RAW_FACTOR = BILLING_RAW_SCALE / LEGACY_BILLING_SCALE;

export const DEFAULT_BILLING_DISPLAY_DECIMALS = 6;
export const MIN_BILLING_DISPLAY_DECIMALS = 0;
export const MAX_BILLING_DISPLAY_DECIMALS = 9;

export type BillingConfig = {
    displayDecimals: number;
}

const toFiniteNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
};

export const normalizeRawBillingAmount = (value: unknown): number => {
    return Math.max(0, Math.round(toFiniteNumber(value)));
};

export const legacyBillingAmountToRaw = (value: unknown): number => {
    return normalizeRawBillingAmount(toFiniteNumber(value) * LEGACY_TO_RAW_FACTOR);
};

// 美元 → raw 内部单位 ($1 = 1e9 raw)
export const dollarsToRaw = (value: unknown): number => {
    return normalizeRawBillingAmount(toFiniteNumber(value) * BILLING_RAW_SCALE);
};

// raw 内部单位 → 美元
export const rawToDollars = (value: unknown): number => {
    const raw = toFiniteNumber(value);
    if (!Number.isFinite(raw)) return 0;
    const dollars = raw / BILLING_RAW_SCALE;
    return Math.round(dollars * 1_000_000) / 1_000_000;
};

// raw 内部单位 → legacy 美元显示单位 (1e6 scale, $1 = 1_000_000 legacy)
export const rawBillingAmountToLegacy = (value: unknown): number => {
    const raw = toFiniteNumber(value);
    if (!Number.isFinite(raw)) return 0;
    const legacy = raw / LEGACY_TO_RAW_FACTOR;
    // 保留合理精度, 避免浮点尾巴 (最多 6 位小数)
    return Math.round(legacy * 1_000_000) / 1_000_000;
};

export const calculateTokenRateCostRaw = (tokens: unknown, rate: unknown): number => {
    return normalizeRawBillingAmount(toFiniteNumber(tokens) * toFiniteNumber(rate) * LEGACY_TO_RAW_FACTOR);
};

export const calculateRequestCostRaw = (value: unknown): number => {
    return legacyBillingAmountToRaw(value);
};

export const normalizeBillingDisplayDecimals = (value: unknown): number => {
    const parsed = Math.round(toFiniteNumber(value));

    if (!Number.isFinite(parsed)) {
        return DEFAULT_BILLING_DISPLAY_DECIMALS;
    }

    return Math.min(
        MAX_BILLING_DISPLAY_DECIMALS,
        Math.max(MIN_BILLING_DISPLAY_DECIMALS, parsed)
    );
};

export const normalizeBillingConfig = (value: Partial<BillingConfig> | null | undefined): BillingConfig => {
    return {
        displayDecimals: normalizeBillingDisplayDecimals(value?.displayDecimals),
    };
};
