import { Context } from "hono";
import { buildUpstreamRequestHeaders, OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST } from "./shared/upstream-request-headers";

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");
const joinPath = (...segments: string[]): string => {
    const cleaned = segments.map(trimSlashes).filter((s) => s.length > 0);
    return `/${cleaned.join("/")}`;
};

// 轮询参数:最长等待时间与轮询间隔(毫秒)
const AGNES_MAX_WAIT_MS = 120 * 1000;
const AGNES_POLL_INTERVAL_MS = 4000;

/**
 * 视频生成代理(video-proxy)
 *
 * 自适应两种上游:
 *  - openai-video   : 标准 OpenAI 视频端点 POST /v1/videos/generations,原样透传
 *  - agnes-video    : agnes-ai 异步任务模式
 *      1) POST /videos  提交任务 → { task_id, status }
 *      2) GET /videos/{task_id} 轮询 → status 变 completed,视频 URL 在 metadata.url
 *      统一包装成 OpenAI 兼容响应 { id, object, status, data:[{url}] }
 */
export default {
    async fetch(
        c: Context<HonoCustomType>,
        config: ChannelConfig,
        requestBody: any,
        saveUsage: (usage: Usage) => Promise<void>,
        trackingState: RequestTrackingState,
    ): Promise<Response> {
        const apiKey = config.api_key || (config.api_keys && config.api_keys[0]) || "public";
        const providerType = config.type || "openai";

        if (providerType === "agnes-video") {
            return handleAgnesVideo(c, config, requestBody, apiKey, trackingState);
        }
        const url = new URL(c.req.raw.url);
        const targetUrl = new URL(config.endpoint);

        if (targetUrl.pathname.endsWith("#")) {
            // 保留 endpoint 原样
        } else {
            const basePath = trimSlashes(targetUrl.pathname);
            const normalizedRequestPath = url.pathname.replace(/^\/v1(?=\/|$)/, "");
            targetUrl.pathname = joinPath(basePath, normalizedRequestPath);
        }

        const targetHeaders = buildUpstreamRequestHeaders(c.req.raw, {
            allowHeaders: OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST,
            overrideHeaders: { Authorization: `Bearer ${apiKey}` },
        });

        if (requestBody && typeof requestBody === "object" && requestBody.__rawBody !== undefined) {
            if (requestBody.__contentType) targetHeaders.set("content-type", requestBody.__contentType);
            return fetch(new Request(targetUrl, { method: c.req.raw.method, headers: targetHeaders, body: requestBody.__rawBody }));
        }

        return fetch(new Request(targetUrl, {
            method: c.req.raw.method,
            headers: targetHeaders,
            body: JSON.stringify(requestBody),
        }));
    },
};

// ---------------------------------------------------------------------------
// agnes-ai 异步视频任务适配
// ---------------------------------------------------------------------------
async function handleAgnesVideo(
    c: Context<HonoCustomType>,
    config: ChannelConfig,
    requestBody: any,
    apiKey: string,
    trackingState: RequestTrackingState,
): Promise<Response> {
    const baseUrl = config.endpoint.replace(/\/+$/, "");
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };

    // duration 需为 int(agnes 要求)
    const submitBody: any = {
        model: requestBody.model,
        prompt: requestBody.prompt || requestBody.input || "",
    };
    if (requestBody.duration !== undefined) {
        submitBody.duration = typeof requestBody.duration === "number"
            ? Math.round(requestBody.duration)
            : parseInt(String(requestBody.duration), 10);
    }

    // 1) 提交任务到 POST /videos
    let submitResp: Response;
    try {
        submitResp = await fetch(`${baseUrl}/videos`, {
            method: "POST",
            headers,
            body: JSON.stringify(submitBody),
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : "video submit failed";
        trackingState.upstreamStatus = 502;
        return c.json({ error: { message: msg, type: "proxy_error" } }, 502);
    }

    trackingState.upstreamStatus = submitResp.status;
    if (!submitResp.ok) {
        const errText = await submitResp.text();
        return new Response(errText, { status: submitResp.status, headers: { "content-type": submitResp.headers.get("content-type") || "application/json" } });
    }

    let taskData: any;
    try {
        taskData = await submitResp.json();
    } catch {
        return c.json({ error: { message: "Invalid task submit response", type: "proxy_error" } }, 502);
    }

    const taskId = taskData.task_id || taskData.video_id || taskData.id;
    if (!taskId) {
        return c.json({ error: { message: "No task_id in upstream response", type: "proxy_error" } }, 502);
    }

    // 2) 轮询 GET /videos/{task_id}
    const deadline = Date.now() + AGNES_MAX_WAIT_MS;
    let status = taskData.status || "queued";
    let latest: any = taskData;

    while (Date.now() < deadline) {
        if (status === "completed" || status === "succeeded" || status === "saved") {
            break;
        }
        if (status === "failed" || status === "error" || status === "cancelled") {
            break;
        }

        await new Promise((r) => setTimeout(r, AGNES_POLL_INTERVAL_MS));

        try {
            const pollResp = await fetch(`${baseUrl}/videos/${taskId}`, { headers });
            if (pollResp.ok) {
                latest = await pollResp.json();
                status = latest.status || status;
            }
        } catch {
            // 单次轮询失败继续尝试
        }
    }

    // 3) 归一化为 OpenAI 兼容响应
    const videoUrl = latest?.metadata?.url || latest?.url || latest?.video_url || "";

    const responsePayload: any = {
        id: taskId,
        object: "video",
        model: latest?.model || requestBody.model,
        status,
        progress: latest?.progress ?? (status === "completed" ? 100 : 0),
        created_at: latest?.created_at,
        completed_at: latest?.completed_at,
    };

    if (status === "completed" || status === "succeeded") {
        responsePayload.data = [{ url: videoUrl }];
    } else {
        // 未完成:返回 task 状态,让客户端可继续轮询
        responsePayload.task_id = taskId;
        responsePayload.error = latest?.error || undefined;
    }

    return c.json(responsePayload);
}

// ---------------------------------------------------------------------------
// 查询 agnes 视频任务状态(供 GET /v1/videos/status 回查)
// ---------------------------------------------------------------------------
export async function queryAgnesVideoStatus(
    c: Context<HonoCustomType>,
    config: ChannelConfig,
    taskId: string,
): Promise<Response> {
    const baseUrl = config.endpoint.replace(/\/+$/, "");
    const apiKey = config.api_key || (config.api_keys && config.api_keys[0]) || "public";

    try {
        const pollResp = await fetch(`${baseUrl}/videos/${taskId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!pollResp.ok) {
            const errText = await pollResp.text();
            return new Response(errText, { status: pollResp.status, headers: { "content-type": "application/json" } });
        }

        const latest: any = await pollResp.json();
        const status = latest?.status || "unknown";
        const videoUrl = latest?.metadata?.url || latest?.url || latest?.video_url || "";

        const payload: any = {
            id: taskId,
            object: "video",
            model: latest?.model,
            status,
            progress: latest?.progress ?? (status === "completed" ? 100 : 0),
            created_at: latest?.created_at,
            completed_at: latest?.completed_at,
        };

        if (status === "completed" || status === "succeeded") {
            payload.data = [{ url: videoUrl }];
        } else {
            payload.task_id = taskId;
            payload.error = latest?.error || undefined;
        }

        return c.json(payload);
    } catch (error) {
        const msg = error instanceof Error ? error.message : "video status query failed";
        return c.json({ error: { message: msg, type: "proxy_error" } }, 502);
    }
}