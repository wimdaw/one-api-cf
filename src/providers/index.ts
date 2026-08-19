import { Context, Hono } from "hono"
import { contentJson, fromHono, OpenAPIRoute } from 'chanfana';
import { z } from "zod";

import db from "../db"
import { resolveRouteId } from "./shared/route-policy"
import { resolveChannel } from "./shared/channel-resolver"
import { executeWithFallbackChannels } from "./shared/upstream-retry"
import { ModelsEndpoint } from "./models"
import { getApiKeyFromHeaders, fetchTokenData, fetchChannelsForToken } from "./shared/auth"
import { queryAgnesVideoStatus } from "./video-proxy"
import { normalizeChannelConfig } from "../channel-config"

export const api = fromHono(new Hono<HonoCustomType>())

api.use("/v1/*", async (c, next) => {
    await db.ensureReady(c);
    await next();
});

// 视频任务状态查询(支持 agnes 异步任务回查)
class VideoStatusEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['OpenAI Proxy'],
        summary: 'Query video generation task status',
        request: {
            query: z.object({
                task_id: z.string().describe('Video task id'),
            }),
            headers: z.object({
                'Authorization': z.string().optional().describe("Token for authentication (OpenAI format)"),
            }),
        },
        responses: {
            200: { description: 'Video task status' },
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const apiKey = getApiKeyFromHeaders(c);
        if (!apiKey) {
            return c.text("Authorization header or x-api-key not found", 401);
        }

        const tokenInfo = await fetchTokenData(c, apiKey);
        if (!tokenInfo) {
            return c.text("Invalid API key", 401);
        }

        const channelsResult = await fetchChannelsForToken(c, tokenInfo.tokenData);
        if (!channelsResult.results || channelsResult.results.length === 0) {
            return c.text("No available channels for this token", 401);
        }

        const taskId = c.req.query("task_id") || "";
        if (!taskId) {
            return c.text("task_id is required", 400);
        }

        // 优先使用 x-channel-key 指定的渠道,否则用第一个 agnes-video / 视频渠道
        const requestedChannelKey = c.req.raw.headers.get('x-channel-key')?.trim();
        const requestedChannel = requestedChannelKey
            ? channelsResult.results.find((row: any) => row.key === requestedChannelKey)
            : null;

        if (requestedChannel) {
            const cfg = normalizeChannelConfig(JSON.parse(requestedChannel.value));
            return queryAgnesVideoStatus(c, cfg, taskId);
        }

        for (const row of channelsResult.results) {
            try {
                const cfg = normalizeChannelConfig(JSON.parse(row.value));
                if (cfg.type === "agnes-video") {
                    return queryAgnesVideoStatus(c, cfg, taskId);
                }
            } catch {
                continue;
            }
        }

        // 兜底:用第一个可用渠道
        const first = channelsResult.results[0];
        try {
            const cfg = normalizeChannelConfig(JSON.parse(first.value));
            return queryAgnesVideoStatus(c, cfg, taskId);
        } catch {
            return c.text("No video channel available", 400);
        }
    }
}

class UnifiedProxyEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['OpenAI Proxy'],
        request: {
            headers: z.object({
                'Authorization': z.string().optional().describe("Token for authentication (OpenAI format)"),
                'x-api-key': z.string().optional().describe("API key for authentication (Claude format)"),
            }),
            body: contentJson(z.any()),
        },
        responses: {
            200: {
                description: 'Successful response',
            },
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const routeId = resolveRouteId(c.req.path)
        if (!routeId) {
            return c.text("Unknown route", 404)
        }

        const result = await resolveChannel(c, routeId)
        if (result instanceof Response) return result

        const { channels, initialChannel, requestBody, saveUsage, logFailure, trackingState, setActiveChannel, rawBody, contentType, isMultipart } = result

        const finalResp = await executeWithFallbackChannels(
            c,
            channels,
            initialChannel,
            requestBody,
            saveUsage,
            logFailure,
            trackingState,
            setActiveChannel,
            rawBody,
            contentType,
            isMultipart,
        )

        return finalResp
    }
}

api.post("/v1/chat/completions", UnifiedProxyEndpoint)
api.post("/v1/completions", UnifiedProxyEndpoint)
api.post("/v1/edits", UnifiedProxyEndpoint)
api.post("/v1/moderations", UnifiedProxyEndpoint)
api.post("/v1/messages", UnifiedProxyEndpoint)
api.post("/v1/responses", UnifiedProxyEndpoint)
api.post("/v1/audio/speech", UnifiedProxyEndpoint)
api.post("/v1/audio/transcriptions", UnifiedProxyEndpoint)
api.post("/v1/audio/translations", UnifiedProxyEndpoint)
api.post("/v1/images/generations", UnifiedProxyEndpoint)
api.post("/v1/images/edits", UnifiedProxyEndpoint)
api.post("/v1/images/variations", UnifiedProxyEndpoint)
api.post("/v1/engines/:model/embeddings", UnifiedProxyEndpoint)
api.post("/v1/videos/generations", UnifiedProxyEndpoint)
api.post("/v1/video/generations", UnifiedProxyEndpoint)
api.get("/v1/videos/status", VideoStatusEndpoint)
api.post("/v1/embeddings", UnifiedProxyEndpoint)
api.get("/v1/models", ModelsEndpoint)

// ---------------------------------------------------------------------------
// 未实现端点 (移植自 one-api: RelayNotImplemented, 返回标准 OpenAI 501 错误)
// files / fine-tuning / assistants / threads 在原版同样未实现
// ---------------------------------------------------------------------------
const notImplemented = (c: Context<HonoCustomType>) => {
    return c.json(
        {
            error: {
                message: "API not implemented",
                type: "one_api_error",
                param: "",
                code: "api_not_implemented",
            },
        },
        501
    )
}

// files
api.get("/v1/files", notImplemented)
api.post("/v1/files", notImplemented)
api.delete("/v1/files/:id", notImplemented)
api.get("/v1/files/:id", notImplemented)
api.get("/v1/files/:id/content", notImplemented)
// fine-tuning
api.post("/v1/fine_tuning/jobs", notImplemented)
api.get("/v1/fine_tuning/jobs", notImplemented)
api.get("/v1/fine_tuning/jobs/:id", notImplemented)
api.post("/v1/fine_tuning/jobs/:id/cancel", notImplemented)
api.get("/v1/fine_tuning/jobs/:id/events", notImplemented)
// assistants
api.post("/v1/assistants", notImplemented)
api.get("/v1/assistants/:id", notImplemented)
api.post("/v1/assistants/:id", notImplemented)
api.delete("/v1/assistants/:id", notImplemented)
api.get("/v1/assistants", notImplemented)
api.post("/v1/assistants/:id/files", notImplemented)
api.get("/v1/assistants/:id/files/:fileId", notImplemented)
api.delete("/v1/assistants/:id/files/:fileId", notImplemented)
api.get("/v1/assistants/:id/files", notImplemented)
// threads
api.post("/v1/threads", notImplemented)
api.get("/v1/threads/:id", notImplemented)
api.post("/v1/threads/:id", notImplemented)
api.delete("/v1/threads/:id", notImplemented)
api.post("/v1/threads/:id/messages", notImplemented)
api.get("/v1/threads/:id/messages/:messageId", notImplemented)
api.post("/v1/threads/:id/messages/:messageId", notImplemented)
api.get("/v1/threads/:id/messages/:messageId/files/:filesId", notImplemented)
api.get("/v1/threads/:id/messages/:messageId/files", notImplemented)
api.post("/v1/threads/:id/runs", notImplemented)
api.get("/v1/threads/:id/runs/:runsId", notImplemented)
api.post("/v1/threads/:id/runs/:runsId", notImplemented)
api.get("/v1/threads/:id/runs", notImplemented)
api.post("/v1/threads/:id/runs/:runsId/submit_tool_outputs", notImplemented)
api.post("/v1/threads/:id/runs/:runsId/cancel", notImplemented)
api.get("/v1/threads/:id/runs/:runsId/steps/:stepId", notImplemented)
api.get("/v1/threads/:id/runs/:runsId/steps", notImplemented)
