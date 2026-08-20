import { Context } from "hono";

// 微软 Edge TTS 免费语音代理 (azure-tts)
// 接收 OpenAI 兼容 POST /v1/audio/speech { model, input, voice?, rate?, volume?, pitch? }
// → 调用微软 Translator endpoint + cognitiveservices TTS (纯 HTTP, Workers 兼容) → audio/mpeg 流
// 音色/语速/音量/音调均来自渠道配置(config), 请求体参数可临时覆盖。
//
// 协议要点 (参考 linshenkx/edge-tts-openai-cf-worker):
//  1) POST dev.microsofttranslator.com/apps/endpoint 获取 JWT token + 区域 (X-MT-Signature HMAC 签名)
//  2) POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1 携带 SSML → 音频
//  全部使用标准 fetch + Web Crypto, Cloudflare Workers / Node 均兼容。

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const TOKEN_REFRESH_BEFORE_EXPIRY = 5 * 60; // 提前 5 分钟刷新 token
const ENDPOINT_URL = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
const MT_SIGNING_KEY_B64 = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";

let tokenInfo: { r: string; t: string; expiredAt: number } | null = null;

const uuid = (): string => crypto.randomUUID().replace(/-/g, "");

const hmacSha256 = async (key: Uint8Array, data: string): Promise<Uint8Array> => {
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
};

const base64ToBytes = (b64: string): Uint8Array => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const dateFormat = (): string => new Date().toUTCString().replace(/GMT/, "").trim() + " GMT";

// 生成 X-MT-Signature (MSTranslatorAndroidApp HMAC)
const sign = async (urlStr: string): Promise<string> => {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = uuid();
    const d = dateFormat();
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${d}${uuidStr}`.toLowerCase();
    const key = base64ToBytes(MT_SIGNING_KEY_B64);
    const sig = await hmacSha256(key, bytesToSign);
    return `MSTranslatorAndroidApp::${bytesToBase64(sig)}::${d}::${uuidStr}`;
};

// 获取 (并缓存) endpoint token
const getEndpoint = async (): Promise<{ r: string; t: string }> => {
    const now = Date.now() / 1000;
    if (tokenInfo && tokenInfo.t && tokenInfo.expiredAt && now < tokenInfo.expiredAt - TOKEN_REFRESH_BEFORE_EXPIRY) {
        return tokenInfo;
    }

    const clientId = uuid();
    const response = await fetch(ENDPOINT_URL, {
        method: "POST",
        headers: {
            "Accept-Language": "zh-Hans",
            "X-ClientVersion": "4.0.530a 5fe1dc6c",
            "X-UserId": "0f04d16a175c411e",
            "X-HomeGeographicRegion": "zh-Hans-CN",
            "X-ClientTraceId": clientId,
            "X-MT-Signature": await sign(ENDPOINT_URL),
            "User-Agent": "okhttp/4.5.0",
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": "0",
            "Accept-Encoding": "gzip",
        },
    });

    if (!response.ok) {
        throw new Error(`Azure TTS: endpoint token failed (${response.status})`);
    }

    const data = (await response.json()) as { r?: string; t?: string };
    if (!data.t) {
        throw new Error("Azure TTS: endpoint token missing");
    }

    let expiredAt = now + 3600;
    try {
        const payload = JSON.parse(atob(data.t.split(".")[1]));
        if (typeof payload.exp === "number") expiredAt = payload.exp;
    } catch { /* ignore */ }

    tokenInfo = { r: data.r || "eastus", t: data.t, expiredAt };
    return tokenInfo;
};

const buildSsml = (text: string, voice: string, rate: string, volume: string, pitch: string): string => {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const locale = voice.split("-").slice(0, 2).join("-");
    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="${locale}">
    <voice name="${voice}">
        <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
            ${escaped}
        </prosody>
    </voice>
</speak>`;
};

const normalizeRate = (v?: string): string => {
    const s = (v || "").trim();
    if (!s) return "+0%";
    return /^[+-]?\d+%$/.test(s) || /^[+-]?\d+(\.\d+)?x$/.test(s) ? s : "+0%";
};
const normalizeVolume = (v?: string): string => {
    const s = (v || "").trim();
    return /^[+-]?\d+%$/.test(s) ? s : "+0%";
};
const normalizePitch = (v?: string): string => {
    const s = (v || "").trim();
    return /^[+-]?\d+(Hz|%)$/.test(s) ? s : "+0Hz";
};

// 核心: HTTP 合成语音, 返回 MP3 ArrayBuffer
export const synthesizeAzureTts = async (
    text: string,
    options: { voice?: string; rate?: string; volume?: string; pitch?: string } = {},
    timeoutMs = 30000
): Promise<{ audio: Uint8Array; usedVoice: string }> => {
    const voice = options.voice || DEFAULT_VOICE;
    const rate = normalizeRate(options.rate);
    const volume = normalizeVolume(options.volume);
    const pitch = normalizePitch(options.pitch);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const endpoint = await getEndpoint();
        const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const ssml = buildSsml(text, voice, rate, volume, pitch);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": endpoint.t,
                "Content-Type": "application/ssml+xml",
                "User-Agent": "okhttp/4.5.0",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            },
            body: ssml,
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = (await response.text()).slice(0, 300);
            throw new Error(`Azure TTS: upstream ${response.status} - ${errorText}`);
        }

        const buffer = await response.arrayBuffer();
        return { audio: new Uint8Array(buffer), usedVoice: voice };
    } catch (error) {
        if ((error as Error).name === "AbortError") {
            throw new Error("Azure TTS: synthesis timeout");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

// OpenAI 兼容 handler: POST /v1/audio/speech
export default {
    async fetch(
        c: Context<HonoCustomType>,
        config: ChannelConfig,
        requestBody?: any,
        saveUsage?: (usage: Usage) => Promise<void>,
        trackingState?: RequestTrackingState,
    ): Promise<Response> {
        try {
            const input = typeof requestBody?.input === "string" ? requestBody.input.trim() : "";
            if (!input) {
                return c.json({ error: { message: "Azure TTS: input text is required", type: "invalid_request_error" } }, 400);
            }

            // 参数优先级: 请求体 voice > 模型名(形如音色) > 渠道配置 > 默认值
            const modelName = typeof requestBody?.model === "string" ? requestBody.model.trim() : "";
            const isVoiceLike = /^[a-z]{2}(-[A-Z]{2})?-[A-Za-z]+Neural$/.test(modelName);
            const voice = (typeof requestBody?.voice === "string" && requestBody.voice.trim())
                ? requestBody.voice.trim()
                : (isVoiceLike ? modelName : (config.voice || DEFAULT_VOICE));
            const rate = (typeof requestBody?.rate === "string" && requestBody.rate.trim())
                ? requestBody.rate.trim()
                : (config.rate || "+0%");
            const volume = (typeof requestBody?.volume === "string" && requestBody.volume.trim())
                ? requestBody.volume.trim()
                : (config.volume || "+0%");
            const pitch = (typeof requestBody?.pitch === "string" && requestBody.pitch.trim())
                ? requestBody.pitch.trim()
                : (config.pitch || "+0Hz");

            if (trackingState) trackingState.upstreamStatus = 200;

            const { audio, usedVoice } = await synthesizeAzureTts(input, { voice, rate, volume, pitch });

            if (saveUsage) {
                await saveUsage({
                    prompt_tokens: Math.ceil(input.length / 4),
                    completion_tokens: 0,
                    total_tokens: Math.ceil(input.length / 4),
                });
            }

            return new Response(audio, {
                status: 200,
                headers: {
                    "Content-Type": "audio/mpeg",
                    "Content-Length": String(audio.byteLength),
                    "X-Azure-TTS-Voice": usedVoice,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[azure-tts]", message);
            return c.json({ error: { message, type: "azure_tts_error" } }, 502);
        }
    },
};