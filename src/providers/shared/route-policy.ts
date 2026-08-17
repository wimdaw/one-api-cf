export type RouteId =
    | "chat-completions"
    | "messages"
    | "responses"
    | "audio-speech"
    | "audio-transcriptions"
    | "audio-translations"
    | "images-generations"
    | "images-edits"
    | "video-generations"
    | "embeddings"

type RoutePolicy = {
    allowedTypes: ChannelType[] | null
    // multipart 请求(文件上传):body 不能按 JSON 解析
    multipart?: boolean
}

const CHAT_COMPLETIONS_CHANNEL_TYPES: ChannelType[] = [
    "openai",
    "azure-openai",
    "gemini",
]

const MESSAGES_CHANNEL_TYPES: ChannelType[] = [
    "claude",
    "claude-to-openai",
]

const OPENAI_TYPES: ChannelType[] = ["openai", "azure-openai", "gemini"]

const VIDEO_TYPES: ChannelType[] = ["openai", "openai-video", "agnes-video"]

const ROUTE_POLICIES: Record<RouteId, RoutePolicy> = {
    "chat-completions": { allowedTypes: CHAT_COMPLETIONS_CHANNEL_TYPES },
    "messages":         { allowedTypes: MESSAGES_CHANNEL_TYPES },
    "responses":        { allowedTypes: ["openai-responses", "azure-openai-responses"] },
    "audio-speech":     { allowedTypes: ["openai-audio", "azure-openai-audio", "azure-tts"] },
    // 语音转写/翻译分文件上传,multipart
    "audio-transcriptions": { allowedTypes: OPENAI_TYPES, multipart: true },
    "audio-translations":   { allowedTypes: OPENAI_TYPES, multipart: true },
    // 生图
    "images-generations": { allowedTypes: OPENAI_TYPES },
    "images-edits":       { allowedTypes: OPENAI_TYPES, multipart: true },
    // 视频生成(OpenAI 新端点 / agnes 异步任务)
    "video-generations": { allowedTypes: VIDEO_TYPES },
    // 向量嵌入(纯 JSON)
    "embeddings": { allowedTypes: OPENAI_TYPES },
}

export const resolveRouteId = (pathname: string): RouteId | null => {
    if (pathname.endsWith("/chat/completions")) return "chat-completions"
    if (pathname.endsWith("/messages")) return "messages"
    if (pathname.endsWith("/responses")) return "responses"
    if (pathname.endsWith("/audio/speech")) return "audio-speech"
    if (pathname.endsWith("/audio/transcriptions")) return "audio-transcriptions"
    if (pathname.endsWith("/audio/translations")) return "audio-translations"
    if (pathname.endsWith("/images/generations")) return "images-generations"
    if (pathname.endsWith("/images/edits")) return "images-edits"
    if (pathname.endsWith("/videos/generations") || pathname.endsWith("/video/generations")) return "video-generations"
    if (pathname.endsWith("/embeddings")) return "embeddings"
    return null
}

export const getRoutePolicy = (routeId: RouteId): RoutePolicy => {
    return ROUTE_POLICIES[routeId]
}