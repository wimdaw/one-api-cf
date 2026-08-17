import { Context } from "hono";

// 渠道显示名映射: 把 usage_record 里的 channel_key 映射为渠道显示名(config.name)
// 缓存 30s, 避免每次请求重复读库

let channelNameCache: { fetchedAt: number; map: Record<string, string> } | undefined;

export const getChannelDisplayNameMap = async (
    c: Context<HonoCustomType>
): Promise<Record<string, string>> => {
    if (channelNameCache && Date.now() - channelNameCache.fetchedAt < 30_000) {
        return channelNameCache.map;
    }
    let map: Record<string, string> = {};
    try {
        const rows = await c.env.DB.prepare("SELECT key, value FROM channel_config").all<{ key: string; value: string }>();
        for (const row of rows.results || []) {
            try {
                const config = JSON.parse(row.value);
                const name = typeof config?.name === "string" && config.name.trim() ? config.name.trim() : "";
                if (name) map[row.key] = name;
            } catch { /* skip */ }
        }
    } catch { /* skip */ }
    channelNameCache = { fetchedAt: Date.now(), map };
    return map;
};

export const clearChannelNameCache = () => {
    channelNameCache = undefined;
};