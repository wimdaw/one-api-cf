import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";

// ---------------------------------------------------------------------------
// 用户组管理 (移植自 one-api: group)
//   - 用户组: users.user_group 列 (默认 'default')
//   - 渠道组: channel_config JSON 的 groups 字段 (该渠道可被哪些组使用, 空=全部组)
//   - 路由时: 用户组不在渠道 groups 内则该渠道不可用
// ---------------------------------------------------------------------------

// 渠道可用组列表 (兼容旧数据: 无 groups 字段 = 所有组可用)
export const getChannelGroups = (config: Partial<ChannelConfig>): string[] => {
    const groups = (config as any).groups;
    if (!Array.isArray(groups) || groups.length === 0) {
        return ["default"];
    }
    return groups.map((g) => String(g).trim()).filter(Boolean);
};

// 渠道是否对指定用户组可用
export const isChannelGroupAllowed = (
    config: Partial<ChannelConfig>,
    userGroup: string
): boolean => {
    const groups = getChannelGroups(config);
    // 兼容: 只有 default 组标记的渠道对所有组开放? 不 - 按原版语义严格匹配
    // 但为了兼容旧渠道(无 groups 字段), 视为所有组可用
    if (!(config as any).groups) {
        return true;
    }
    return groups.includes(userGroup) || groups.includes("*");
};

// 组名合法性: 字母数字下划线连字符, 最长 32
const GROUP_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

// 确保 group_config 表存在 (Pages 环境可能未执行顶层建表)
async function ensureGroupConfigTable(db: D1Database) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS group_config (
            name TEXT PRIMARY KEY,
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

// 查询所有用户组 (含用户数统计)
export class GroupListEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "List all user groups with member counts",
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        await ensureGroupConfigTable(c.env.DB);
        const rows = await c.env.DB.prepare(
            `SELECT user_group, COUNT(*) AS member_count FROM users GROUP BY user_group ORDER BY user_group ASC`
        ).all<{ user_group: string; member_count: number }>();

        // 补充渠道引用: 每个组可用的渠道数
        const channelRows = await c.env.DB.prepare(
            "SELECT value FROM channel_config"
        ).all<{ value: string }>();
        const groupChannelCount = new Map<string, number>();
        for (const row of channelRows.results || []) {
            try {
                const config = JSON.parse(row.value) as ChannelConfig;
                const groups = getChannelGroups(config);
                for (const g of groups) {
                    groupChannelCount.set(g, (groupChannelCount.get(g) || 0) + 1);
                }
            } catch {
                // skip
            }
        }

        const groups: Array<{ name: string; member_count: number; channel_count: number; explicit: boolean; description?: string }> = (rows.results || []).map((row) => ({
            name: row.user_group || "default",
            member_count: Number(row.member_count) || 0,
            channel_count: groupChannelCount.get(row.user_group || "default") || 0,
            explicit: false,
        }));

        // 合并渠道中引用但无用户的组
        for (const [g, count] of groupChannelCount) {
            if (!groups.some((x) => x.name === g)) {
                groups.push({ name: g, member_count: 0, channel_count: count, explicit: false });
            }
        }

        // 合并显式创建的组 (group_config 表)
        const configRows = await c.env.DB.prepare(
            `SELECT name, description, created_at FROM group_config ORDER BY name ASC`
        ).all<{ name: string; description: string; created_at: string }>();
        for (const row of configRows.results || []) {
            const existing = groups.find((x) => x.name === row.name);
            if (existing) {
                existing.explicit = true;
                existing.description = row.description || "";
            } else {
                groups.push({
                    name: row.name,
                    member_count: 0,
                    channel_count: 0,
                    explicit: true,
                    description: row.description || "",
                });
            }
        }

        // default 组始终展示 (即使无用户无渠道)
        if (!groups.some((x) => x.name === "default")) {
            groups.unshift({ name: "default", member_count: 0, channel_count: 0, explicit: false });
        }

        return {
            success: true,
            data: { groups },
        } as CommonResponse;
    }
}

// 创建用户组 (显式注册, 便于管理) — Hono handler (避免 esbuild tree-shaking)
export async function createGroup(c: Context<HonoCustomType>) {
    await ensureGroupConfigTable(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();

    if (!GROUP_NAME_RE.test(name)) {
        return c.json({ success: false, error: "Invalid group name (alphanumeric, underscore, hyphen, max 32)" }, 400);
    }
    if (name === "default") {
        return c.json({ success: false, error: "The default group already exists" }, 400);
    }

    const existing = await c.env.DB.prepare(
        `SELECT name FROM group_config WHERE name = ?`
    ).bind(name).first();
    if (existing) {
        return c.json({ success: false, error: "Group already exists" }, 409);
    }

    await c.env.DB.prepare(
        `INSERT INTO group_config (name, description) VALUES (?, ?)`
    ).bind(name, description).run();

    return c.json({ success: true, data: { name, description } });
}

// 删除用户组 (仅删除注册记录; 用户/渠道仍可隐式引用) — Hono handler
export async function deleteGroup(c: Context<HonoCustomType>) {
    const { name } = c.req.param();
    if (name === "default") {
        return c.json({ success: false, error: "Cannot delete the default group" }, 400);
    }

    const result = await c.env.DB.prepare(
        `DELETE FROM group_config WHERE name = ?`
    ).bind(name).run();

    return c.json({
        success: true,
        data: { deleted: result.meta?.changes ?? 0 },
    });
}

// 修改用户所属组
export class GroupSetUserEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Set a user's group",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            user_id: z.number().int().positive(),
                            group: z.string().max(32),
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
        const body = await c.req.json().catch(() => ({}));
        const userId = Number(body.user_id);
        const group = String(body.group || "").trim();

        if (!Number.isInteger(userId) || userId <= 0) {
            return c.text("user_id is required", 400);
        }
        if (!GROUP_NAME_RE.test(group)) {
            return c.text("Invalid group name (letters, digits, _ - ; max 32 chars)", 400);
        }

        const result = await c.env.DB.prepare(
            "UPDATE users SET user_group = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(group, userId).run();

        if (!result.meta?.changes) {
            return c.text("User not found", 404);
        }
        return {
            success: true,
            data: { user_id: userId, group },
        } as CommonResponse;
    }
}

// 渠道组设置 (渠道 JSON 的 groups 字段)
export class GroupSetChannelEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Set which groups can use a channel",
        request: {
            params: z.object({
                key: z.string(),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            groups: z.array(z.string().max(32)).describe("Groups allowed to use this channel; empty = all groups"),
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
        const { key } = c.req.param();
        const body = await c.req.json().catch(() => ({}));
        const rawGroups = Array.isArray(body.groups) ? body.groups : [];

        const groups = [...new Set(rawGroups.map((g: unknown) => String(g).trim()).filter(Boolean))];
        for (const g of groups) {
            if (!GROUP_NAME_RE.test(g as string)) {
                return c.text(`Invalid group name: ${g}`, 400);
            }
        }

        const row = await c.env.DB.prepare(
            "SELECT value FROM channel_config WHERE key = ?"
        ).bind(key).first<{ value: string }>();
        if (!row) {
            return c.text("Channel not found", 404);
        }

        let config: ChannelConfig;
        try {
            config = JSON.parse(row.value) as ChannelConfig;
        } catch {
            return c.text("Invalid channel config", 500);
        }

        (config as any).groups = groups;
        await c.env.DB.prepare(
            "UPDATE channel_config SET value = ?, updated_at = datetime('now') WHERE key = ?"
        ).bind(JSON.stringify(config), key).run();

        return {
            success: true,
            data: { key, groups },
        } as CommonResponse;
    }
}

// 渠道组查询 (附带在渠道详情)
export class GroupGetChannelEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get channel group config",
        request: {
            params: z.object({
                key: z.string(),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.any()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const { key } = c.req.param();
        const row = await c.env.DB.prepare(
            "SELECT value FROM channel_config WHERE key = ?"
        ).bind(key).first<{ value: string }>();
        if (!row) {
            return c.text("Channel not found", 404);
        }
        let config: ChannelConfig;
        try {
            config = JSON.parse(row.value) as ChannelConfig;
        } catch {
            return c.text("Invalid channel config", 500);
        }
        return {
            success: true,
            data: {
                key,
                groups: getChannelGroups(config),
                allowed: isChannelGroupAllowed(config, "default"),
            },
        } as CommonResponse;
    }
}
