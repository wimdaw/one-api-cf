import { Context } from "hono";

// ---------------------------------------------------------------------------
// 免费渠道预设 (Free Channel presets)
// 部署后开箱即用的免 Key AI 网关渠道。
// 在数据库迁移时自动 seed,不存在则插入,已存在则跳过(不覆盖用户配置)。
// ---------------------------------------------------------------------------

// OpenCode 公共镜像地址(cnliussl 大佬提供)。可在 OPENCODE_MIRRORS_URL 环境变量中追加(换行/逗号分隔)。
const DEFAULT_OPENCODE_MIRRORS = [
    "https://opencode.ai.cmliussss.net/zen/v1",
    "https://opencode.fastly.cmliussss.net/zen/v1",
    "https://opencode.gcore.cmliussss.net/zen/v1",
];

// 从环境变量读取 OpenCode 镜像(兼容换行/逗号分隔, 去空白去重), 并入默认镜像
export const resolveOpenCodeMirrors = (env: any): string[] => {
    const raw = env?.OPENCODE_MIRRORS_URL || "";
    const parts = String(raw).split("\n").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    return [...new Set([...DEFAULT_OPENCODE_MIRRORS, ...parts])];
};

// OpenCode 免费后端:https://opencode.ai 的 zen/v1 网关,免 key
export const FREE_OPENCODE_CHANNEL: ChannelConfig = {
    name: "OpenCode (Free)",
    type: "openai",
    endpoint: "https://opencode.ai/zen/v1",
    enabled: true,
    weight: 0,
    api_key: "public",
    api_keys: ["public"],
    auto_retry: true,
    auto_rotate: true,
    mirrors: DEFAULT_OPENCODE_MIRRORS,
    models: [
        { id: "big-pickle", name: "big-pickle" },
        { id: "deepseek-v4-flash-free", name: "deepseek-v4-flash-free" },
        { id: "hy3-free", name: "hy3-free" },
        { id: "laguna-s-2.1-free", name: "laguna-s-2.1-free" },
        { id: "mimo-v2.5-free", name: "mimo-v2.5-free" },
        { id: "nemotron-3-ultra-free", name: "nemotron-3-ultra-free" },
        { id: "nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning-free" },
    ],
};

// Kilo Gateway 免费后端:Kilo Code 官方网关,免 key
export const FREE_KILO_CHANNEL: ChannelConfig = {
    name: "Kilo Gateway (Free)",
    type: "openai",
    endpoint: "https://api.kilo.ai/api/gateway",
    enabled: true,
    weight: 0,
    api_key: "public",
    api_keys: ["public"],
    auto_retry: true,
    auto_rotate: true,
    models: [
        { id: "kilo-auto/free", name: "kilo-auto/free" },
        { id: "cohere/north-mini-code:free", name: "cohere/north-mini-code:free" },
        { id: "dots-studio/dots-3-note-preview:free", name: "dots-studio/dots-3-note-preview:free" },
        { id: "liquid/lfm-2.5-2.6b:free", name: "liquid/lfm-2.5-2.6b:free" },
        { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free" },
        { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "nvidia/nemotron-3-super-120b-a12b:free" },
        { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "nvidia/nemotron-3-ultra-550b-a55b:free" },
        { id: "nvidia/nemotron-3.5-content-safety:free", name: "nvidia/nemotron-3.5-content-safety:free" },
        { id: "nvidia/nemotron-3.5-lightning:free", name: "nvidia/nemotron-3.5-lightning:free" },
        { id: "poolside/laguna-s-2.1:free", name: "poolside/laguna-s-2.1:free" },
        { id: "poolside/laguna-xs-2.1:free", name: "poolside/laguna-xs-2.1:free" },
        { id: "stepfun/step-3.7-flash:free", name: "stepfun/step-3.7-flash:free" },
        { id: "tencent/hy3:free", name: "tencent/hy3:free" },
    ],
};

export const FREE_CHANNEL_PRESETS: { key: string; config: ChannelConfig }[] = [
    { key: "opencode-free", config: FREE_OPENCODE_CHANNEL },
    { key: "kilo-free", config: FREE_KILO_CHANNEL },
];

// 校验:渠道 config 是否已存在于 channel_config 表
async function channelExists(c: Context<HonoCustomType>, key: string): Promise<boolean> {
    const row = await c.env.DB.prepare(
        "SELECT key FROM channel_config WHERE key = ?"
    ).bind(key).first<{ key: string }>();
    return Boolean(row?.key);
}

/**
 * Seed 默认免费渠道。首次部署时自动插入,已存在的渠道跳过。
 * 返回本次实际新增的渠道 key 列表。
 */
export async function seedFreeChannels(
    c: Context<HonoCustomType>
): Promise<string[]> {
    const created: string[] = [];

    for (const preset of FREE_CHANNEL_PRESETS) {
        try {
            const exists = await channelExists(c, preset.key);
            if (exists) {
                // 升级补丁: 已存在的 opencode-free 渠道若未配置镜像, 补默认镜像列表 (不覆盖用户配置)
                if (preset.config.mirrors && preset.config.mirrors.length > 0) {
                    const row = await c.env.DB.prepare(
                        "SELECT value FROM channel_config WHERE key = ?"
                    ).bind(preset.key).first<{ value: string }>();
                    if (row?.value) {
                        try {
                            const existing = JSON.parse(row.value) as ChannelConfig;
                            if (!existing.mirrors || existing.mirrors.length === 0) {
                                existing.mirrors = resolveOpenCodeMirrors(c.env);
                                await c.env.DB.prepare(
                                    `UPDATE channel_config SET value = ?, updated_at = datetime('now') WHERE key = ?`
                                ).bind(JSON.stringify(existing), preset.key).run();
                                console.log(`[seed] Backfilled mirrors for ${preset.key}`);
                            }
                        } catch {
                            // 配置损坏时跳过, 保持原样
                        }
                    }
                }
                continue;
            }

            const config = { ...preset.config, mirrors: resolveOpenCodeMirrors(c.env) };
            await c.env.DB.prepare(
                `INSERT INTO channel_config (key, value)
                 VALUES (?, ?)
                 ON CONFLICT(key) DO NOTHING`
            ).bind(preset.key, JSON.stringify(config)).run();

            created.push(preset.key);
        } catch (error) {
            console.error(`Failed to seed channel ${preset.key}:`, error);
        }
    }

    if (created.length > 0) {
        console.log(`[seed] Seeded free channels: ${created.join(", ")}`);
    }

    return created;
}