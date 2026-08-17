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
        { id: "deepseek-v4-flash-free", name: "deepseek-v4-flash" },
        { id: "hy3-free", name: "hy3" },
        { id: "laguna-s-2.1-free", name: "laguna-s-2.1" },
        { id: "mimo-v2.5-free", name: "mimo-v2.5" },
        { id: "nemotron-3-ultra-free", name: "nemotron-3-ultra" },
        { id: "nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning" },
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
        { id: "kilo-auto/free", name: "kilo-auto" },
        { id: "cohere/north-mini-code:free", name: "cohere/north-mini-code" },
        { id: "dots-studio/dots-3-note-preview:free", name: "dots-studio/dots-3-note-preview" },
        { id: "liquid/lfm-2.5-2.6b:free", name: "liquid/lfm-2.5-2.6b" },
        { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
        { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "nvidia/nemotron-3-super-120b-a12b" },
        { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "nvidia/nemotron-3-ultra-550b-a55b" },
        { id: "nvidia/nemotron-3.5-content-safety:free", name: "nvidia/nemotron-3.5-content-safety" },
        { id: "nvidia/nemotron-3.5-lightning:free", name: "nvidia/nemotron-3.5-lightning" },
        { id: "poolside/laguna-s-2.1:free", name: "poolside/laguna-s-2.1" },
        { id: "poolside/laguna-xs-2.1:free", name: "poolside/laguna-xs-2.1" },
        { id: "stepfun/step-3.7-flash:free", name: "stepfun/step-3.7-flash" },
        { id: "tencent/hy3:free", name: "tencent/hy3" },
    ],
};

// Azure TTS 免费语音渠道: 微软 Edge 在线语音服务, 免 key
// 音色/语速/音量/音调可在后台渠道配置中调整 (voice/rate/volume/pitch)
export const FREE_AZURE_TTS_CHANNEL: ChannelConfig = {
    name: "Azure TTS (Free)",
    type: "azure-tts",
    endpoint: "https://speech.platform.bing.com",
    enabled: true,
    weight: 0,
    api_key: "public",
    api_keys: ["public"],
    auto_retry: true,
    auto_rotate: false,
    voice: "zh-CN-XiaoxiaoNeural",  // 默认音色: 晓晓 (微软默认)
    rate: "+0%",
    volume: "+0%",
    pitch: "+0Hz",
    models: [
        { id: "azure-tts", name: "azure-tts" },
    ],
};

export const FREE_CHANNEL_PRESETS: { key: string; config: ChannelConfig }[] = [
    { key: "opencode-free", config: FREE_OPENCODE_CHANNEL },
    { key: "kilo-free", config: FREE_KILO_CHANNEL },
    { key: "azure-tts-free", config: FREE_AZURE_TTS_CHANNEL },
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
                // 升级补丁: 已存在渠道, 若模型 name 含 free 后缀, 替换为去 free 的对外名 (id 保留真实免费名)
                // 只改含 free 的 name, 不改其他用户自定义 name/id, 幂等
                try {
                    const row = await c.env.DB.prepare(
                        "SELECT value FROM channel_config WHERE key = ?"
                    ).bind(preset.key).first<{ value: string }>();
                    if (row?.value) {
                        const existing = JSON.parse(row.value) as ChannelConfig;
                        let changed = false;
                        if (preset.config.mirrors && preset.config.mirrors.length > 0 && (!existing.mirrors || existing.mirrors.length === 0)) {
                            existing.mirrors = resolveOpenCodeMirrors(c.env);
                            changed = true;
                        }
                        // name 去 free 后缀: 对齐 preset 里的预设 name (只处理 preset 里定义的模型)
                        const presetByName = new Map<string, string>();
                        for (const pm of preset.config.models || []) {
                            presetByName.set(pm.name.toLowerCase(), pm.name);
                            if (pm.id) presetByName.set(pm.id.toLowerCase(), pm.name);
                        }
                        for (const m of existing.models || []) {
                            const target = presetByName.get(m.name?.toLowerCase());
                            if (target && m.name !== target) {
                                m.name = target;
                                changed = true;
                            }
                        }
                        if (changed) {
                            await c.env.DB.prepare(
                                `UPDATE channel_config SET value = ?, updated_at = datetime('now') WHERE key = ?`
                            ).bind(JSON.stringify(existing), preset.key).run();
                            console.log(`[seed] Normalized display names for ${preset.key}`);
                        }
                    }
                } catch {
                    // 配置损坏时跳过, 保持原样
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