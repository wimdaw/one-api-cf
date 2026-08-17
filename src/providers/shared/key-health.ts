import { Context } from "hono";

// 渠道 API Key 健康状态管理 (多 Key 轮询 + 健康检查 / Key 自动恢复)
// 与 ai-gateway 同机制: 连续失败 N 次降权进冷却, 冷却到期自动试用, 成功恢复权重。

export const KEY_HEALTH_MAX_FAILURES = 5;      // 连续失败多少次后降权
export const KEY_HEALTH_COOLDOWN_MS = 5 * 60 * 1000; // 降权后冷却时长 (5 分钟)

export type ChannelKeyHealth = {
    failures: number;
    demotedAt?: number;
};

export type KeyHealthMap = Record<string, ChannelKeyHealth>;

// 读取渠道的 Key 健康状态 (D1)
export const readKeyHealth = async (
    c: Context<HonoCustomType>,
    channelKey: string
): Promise<KeyHealthMap> => {
    try {
        const row = await c.env.DB.prepare(
            "SELECT health_json FROM channel_key_health WHERE channel_key = ?"
        ).bind(channelKey).first<{ health_json: string }>();
        if (!row?.health_json) {
            return {};
        }
        const parsed = JSON.parse(row.health_json) as KeyHealthMap;
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (error) {
        console.warn("[key-health] read failed:", error);
        return {};
    }
};

// 写入渠道的 Key 健康状态 (UPSERT)
export const writeKeyHealth = async (
    c: Context<HonoCustomType>,
    channelKey: string,
    health: KeyHealthMap
): Promise<void> => {
    try {
        await c.env.DB.prepare(
            `INSERT INTO channel_key_health (channel_key, health_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(channel_key) DO UPDATE SET
             health_json = excluded.health_json,
             updated_at = excluded.updated_at`
        ).bind(channelKey, JSON.stringify(health), Math.floor(Date.now() / 1000)).run();
    } catch (error) {
        console.warn("[key-health] write failed:", error);
    }
};

// 按健康状态排序 Key (与 ai-gateway 一致):
// 健康(Fisher-Yates 洗牌) -> 冷却到期(试用) -> 最近失败未降权 -> 全部冷却时兜底降权 Key
export const orderKeysByHealth = (
    keys: string[],
    health: KeyHealthMap
): { ordered: string[]; demotedCount: number; probationCount: number } => {
    const now = Date.now();
    const healthy: string[] = [];
    const unhealthy: string[] = [];
    const probation: string[] = [];
    const demoted: string[] = [];

    if (keys.length <= 1) {
        return { ordered: [...keys], demotedCount: 0, probationCount: 0 };
    }

    for (const key of keys) {
        const h = health[key];
        if (h && h.failures >= KEY_HEALTH_MAX_FAILURES) {
            if (!h.demotedAt) {
                h.demotedAt = now;
            }
            if (now - h.demotedAt >= KEY_HEALTH_COOLDOWN_MS) {
                probation.push(key); // 冷却到期, 进入试用组
            } else {
                demoted.push(key); // 仍在冷却, 保持降权
            }
        } else if (h && h.failures > 0) {
            unhealthy.push(key); // 失败过但未达降权阈值
        } else {
            healthy.push(key);
        }
    }

    // Fisher-Yates 洗牌(仅健康 Key)
    for (let i = healthy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [healthy[i], healthy[j]] = [healthy[j], healthy[i]];
    }

    const ordered = [...healthy, ...probation, ...unhealthy];

    // 所有 Key 都在冷却中时, 兜底尝试降权 Key (避免死循环)
    if (ordered.length === 0 && demoted.length > 0) {
        ordered.push(...demoted);
    }

    return {
        ordered,
        demotedCount: demoted.length,
        probationCount: probation.length,
    };
};

// Key 请求成功: 清除健康记录 (恢复权重)
export const markKeySuccess = (
    health: KeyHealthMap,
    apiKey: string
): boolean => {
    if (health[apiKey]) {
        delete health[apiKey];
        return true;
    }
    return false;
};

// Key 请求失败: 失败计数 +1; 连续失败达阈值则降权(记录降权时间, 进入冷却)。
// 429 限流不标记失败(由调用方跳过, 不计入健康)。
export const markKeyFailure = (
    health: KeyHealthMap,
    apiKey: string
): { demoted: boolean } => {
    const current = health[apiKey] || { failures: 0 };
    current.failures += 1;
    if (current.failures >= KEY_HEALTH_MAX_FAILURES) {
        current.demotedAt = Date.now(); // 达到降权阈值或试用失败, 重置冷却计时
    }
    health[apiKey] = current;
    return { demoted: current.failures >= KEY_HEALTH_MAX_FAILURES };
};

