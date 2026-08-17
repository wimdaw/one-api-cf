import { Context } from "hono"
import { checkoutUsageData, handleStreamResponse } from "./shared/openai-stream-utils"
import { buildPrefixedTargetUrl } from "./shared/prefixed-target-url"
import {
    buildUpstreamRequestHeaders,
    OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST,
} from "./shared/upstream-request-headers"

// 免 Key 渠道(如 OpenCode / Kilo Gateway)使用 public 作为默认 Bearer
const DEFAULT_PUBLIC_KEY = "public"

const buildProxyRequestFor = (
    request: Request,
    reqJson: any,
    endpoint: string,
    apiKey: string,
    type: ChannelType
): Request => {
    const url = new URL(request.url)
    const targetUrl = buildPrefixedTargetUrl(endpoint, url.pathname, "/v1", type)
    const targetHeaders = buildUpstreamRequestHeaders(request, {
        allowHeaders: OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST,
        overrideHeaders: {
            Authorization: `Bearer ${apiKey}`,
        },
    })

    // multipart 文件上传(音频转录/图片编辑):透传原始 body 与 content-type
    if (reqJson && typeof reqJson === "object" && reqJson.__rawBody !== undefined) {
        if (reqJson.__contentType) {
            targetHeaders.set("content-type", reqJson.__contentType);
        }
        return new Request(targetUrl, {
            method: request.method,
            headers: targetHeaders,
            body: reqJson.__rawBody,
        })
    }

    return new Request(targetUrl, {
        method: request.method,
        headers: targetHeaders,
        body: JSON.stringify(reqJson),
    })
}

// 解析镜像列表(兼容换行/逗号分隔, 去空白去重)
const parseMirrors = (mirrors?: string[]): string[] => {
    if (!mirrors || mirrors.length === 0) return []
    const parts = mirrors.flatMap((item) => String(item || "").split("\n")).flatMap((item) => item.split(","))
        .map((item) => item.trim()).filter(Boolean)
    return [...new Set(parts)]
}

const hasRealApiKey = (config: ChannelConfig): boolean => {
    return Boolean(config.api_key && config.api_key !== DEFAULT_PUBLIC_KEY && config.api_key.trim() !== "")
}

export default {
    async fetch(
        c: Context<HonoCustomType>,
        config: ChannelConfig,
        requestBody: any,
        saveUsage: (usage: Usage) => Promise<void>,
        trackingState: RequestTrackingState,
    ): Promise<Response> {
        const { stream } = requestBody

        if (stream) {
            requestBody.stream_options = {
                ...(requestBody.stream_options || {}),
                include_usage: true,
            }
        }

        const mirrors = parseMirrors(config.mirrors)
        const officialEndpoint = config.endpoint
        const officialKey = hasRealApiKey(config) ? (config.api_key as string) : DEFAULT_PUBLIC_KEY

        // 构建候选端点顺序:
        //  - 配置真实 Key: 官方优先, 失败后轮询镜像(Bearer public)
        //  - 无真实 Key(免 Key 渠道): 直接使用公共镜像; 未配置镜像时回退官方 public
        const candidates: Array<{ endpoint: string; apiKey: string }> = []
        if (mirrors.length === 0) {
            candidates.push({ endpoint: officialEndpoint, apiKey: officialKey })
        } else if (hasRealApiKey(config)) {
            candidates.push({ endpoint: officialEndpoint, apiKey: officialKey })
            mirrors.forEach((mirror) => candidates.push({ endpoint: mirror, apiKey: DEFAULT_PUBLIC_KEY }))
        } else {
            mirrors.forEach((mirror) => candidates.push({ endpoint: mirror, apiKey: DEFAULT_PUBLIC_KEY }))
            // 镜像全失败时回退官方 public (保持可用性)
            candidates.push({ endpoint: officialEndpoint, apiKey: DEFAULT_PUBLIC_KEY })
        }

        let lastError: Response | null = null
        let attempt: { endpoint: string; apiKey: string } | null = null

        for (const candidate of candidates) {
            attempt = candidate
            let proxyRequest: Request
            try {
                proxyRequest = buildProxyRequestFor(c.req.raw, requestBody, candidate.endpoint, candidate.apiKey, config.type)
            } catch (error) {
                console.warn(`[openai-proxy] build request failed for ${candidate.endpoint}:`, error)
                continue
            }

            let response: Response
            try {
                response = await fetch(proxyRequest)
            } catch (error) {
                console.warn(`[openai-proxy] fetch failed for ${candidate.endpoint}:`, error)
                lastError = new Response(JSON.stringify({ error: { message: String(error), type: "proxy_error" } }), {
                    status: 502,
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
                continue
            }

            trackingState.upstreamStatus = response.status

            // 成功即返回(含流式)
            if (response.ok) {
                if (stream) {
                    if (!response.body) {
                        return response
                    }
                    const [streamForClient, streamForServer] = response.body.tee()
                    c.executionCtx.waitUntil(
                        handleStreamResponse(c, streamForServer, saveUsage).catch((error) => {
                            console.warn("Failed to track usage from upstream stream:", error)
                        })
                    )
                    return new Response(streamForClient, {
                        headers: response.headers,
                        status: response.status,
                        statusText: response.statusText,
                    })
                }

                if (response.ok) {
                    await checkoutUsageData(saveUsage, response, requestBody)
                }
                return response
            }

            // 失败: 保存供兜底返回, 继续下一个候选
            lastError = response
        }

        // 全部候选失败: 返回最后一个真实上游响应(若存在), 否则 502
        return lastError || new Response(JSON.stringify({ error: { message: "All upstream endpoints failed", type: "proxy_error" } }), {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8" },
        })
    }
}
