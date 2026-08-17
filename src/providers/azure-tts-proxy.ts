import { Context } from "hono";
import WebSocket from "ws";

// 微软 Edge TTS 免费语音代理 (azure-tts)
// 接收 OpenAI 兼容 POST /v1/audio/speech { model, input, voice?, rate?, volume?, pitch? }
// → 调用微软 Edge 在线语音服务(免费) → 返回 audio/mpeg 流
// 音色/语速/音量/音调均来自渠道配置(config), 请求体参数可临时覆盖。
//
// 协议要点:
//  - Sec-MS-GEC = SHA-256 摘要(windowsTicks + trustedClientToken) 转大写 hex (纯哈希, 非 HMAC)
//  - WebSocket 连接需带 UA + Origin 头
//  - 发送 speech.config(JSON) + ssml 两条消息, 接收二进制音频帧直至 Path:turn.end

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const SEC_MS_GEC_VERSION = "1-143.0.3650.96";
const JSON_XML_DELIM = "\r\n\r\n";
const AUDIO_DELIM = "Path:audio\r\n";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

const generateUuid = (): string => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        const v = ch === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// 16 位随机 hex (X-RequestId)
const randomHex = (length: number): string => {
    const bytes = new Uint8Array(length);
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// 生成 Sec-MS-GEC: 纯 SHA-256 摘要 (非 HMAC!)
const generateSecMsGec = async (trustedClientToken: string): Promise<string> => {
    const ticks = Math.floor(Date.now() / 1000) + 11644473600;
    const rounded = ticks - (ticks % 300);
    const windowsTicks = rounded * 10000000;
    const encoder = new TextEncoder();
    const data = encoder.encode(`${windowsTicks}${trustedClientToken}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
};

const buildSpeechConfigMessage = (): string => {
    return `Content-Type:application/json; charset=utf-8\r\nPath:speech.config${JSON_XML_DELIM}${JSON.stringify({
        context: {
            synthesis: {
                audio: {
                    metadataoptions: {
                        sentenceBoundaryEnabled: "false",
                        wordBoundaryEnabled: "false",
                    },
                    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                },
            },
        },
    })}`;
};

const buildSsmlMessage = (
    text: string,
    voice: string,
    rate: string,
    volume: string,
    pitch: string
): string => {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const locale = voice.split("-").slice(0, 2).join("-");
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">
    <voice name="${voice}">
        <prosody pitch="${pitch}" rate="${rate}" volume="${volume}">
            ${escaped}
        </prosody>
    </voice>
</speak>`;
    const requestId = randomHex(16);
    return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml${JSON_XML_DELIM}${ssml.trim()}`;
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
    return /^[+-]?\d+Hz$/.test(s) ? s : "+0Hz";
};

// 核心: 通过 WebSocket 合成语音, 返回 MP3 Buffer
export const synthesizeAzureTts = async (
    text: string,
    options: { voice?: string; rate?: string; volume?: string; pitch?: string } = {},
    timeoutMs = 30000
): Promise<{ audio: Uint8Array; usedVoice: string }> => {
    const voice = options.voice || DEFAULT_VOICE;
    const rate = normalizeRate(options.rate);
    const volume = normalizeVolume(options.volume);
    const pitch = normalizePitch(options.pitch);

    const secMsGec = await generateSecMsGec(TRUSTED_CLIENT_TOKEN);
    const url = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${generateUuid()}`;

    const chunks: Buffer[] = [];
    let settled = false;

    return new Promise((resolve, reject) => {
        let ws: WebSocket;
        try {
            ws = new WebSocket(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
                },
            });
        } catch (error) {
            reject(new Error(`Azure TTS: WebSocket init failed - ${(error as Error).message}`));
            return;
        }

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                try { ws.close(); } catch { /* ignore */ }
                reject(new Error("Azure TTS: synthesis timeout"));
            }
        }, timeoutMs);

        ws.on("open", () => {
            ws.send(buildSpeechConfigMessage());
            ws.send(buildSsmlMessage(text, voice, rate, volume, pitch));
        });

        ws.on("message", (data, isBinary) => {
            if (settled) return;
            if (isBinary) {
                // 二进制帧 = 音频头(Path:audio\r\n) + MP3 数据
                const buffer = Buffer.from(data as Buffer);
                const delimIndex = buffer.indexOf(AUDIO_DELIM);
                const audioData = delimIndex >= 0
                    ? buffer.subarray(delimIndex + AUDIO_DELIM.length)
                    : buffer;
                if (audioData.length > 0) {
                    chunks.push(audioData);
                }
            } else {
                const message = data.toString();
                const pathMatch = message.match(/Path:(\S+)/);
                const path = pathMatch ? pathMatch[1] : "";
                if (message.includes("Path:turn.end")) {
                    settled = true;
                    clearTimeout(timer);
                    try { ws.close(); } catch { /* ignore */ }
                    resolve({ audio: new Uint8Array(Buffer.concat(chunks)), usedVoice: voice });
                } else if (path === "error" || message.includes("Path:error")) {
                    settled = true;
                    clearTimeout(timer);
                    try { ws.close(); } catch { /* ignore */ }
                    reject(new Error(`Azure TTS: upstream error - ${message.slice(0, 200)}`));
                }
            }
        });

        ws.on("error", (error) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(new Error(`Azure TTS: websocket error - ${error.message}`));
            }
        });

        ws.on("close", () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                if (chunks.length > 0) {
                    resolve({ audio: new Uint8Array(Buffer.concat(chunks)), usedVoice: voice });
                } else {
                    reject(new Error("Azure TTS: connection closed before audio received"));
                }
            }
        });
    });
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

            // 参数优先级: 请求体 > 渠道配置 > 默认值
            const voice = (typeof requestBody?.voice === "string" && requestBody.voice.trim())
                ? requestBody.voice.trim()
                : (config.voice || DEFAULT_VOICE);
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