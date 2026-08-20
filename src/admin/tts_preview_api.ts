import { Context } from "hono";
import { z } from "zod";
import { OpenAPIRoute } from "chanfana";
import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { synthesizeAzureTts } from "../providers/azure-tts-proxy";

// Azure TTS 音色试听端点 (admin 会话保护, 用于后台渠道配置试听)
// POST /api/admin/tts/preview  { voice, rate?, volume?, pitch?, text? } → audio/mpeg
export class TtsPreviewEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Preview an Azure TTS voice (synthesize a short sample)",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            voice: z.string().min(3).max(128),
                            rate: z.string().max(32).optional(),
                            volume: z.string().max(32).optional(),
                            pitch: z.string().max(32).optional(),
                            text: z.string().max(500).optional(),
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
        const voice = String(body.voice || "").trim();
        if (!voice) {
            return c.json({ success: false, error: "voice is required" }, 400);
        }

        const text = String(body.text || "你好，欢迎使用语音合成，这是一段试听音频。")
            .trim()
            .slice(0, 200);
        const rate = String(body.rate || "+0%").trim();
        const volume = String(body.volume || "+0%").trim();
        const pitch = String(body.pitch || "+0Hz").trim();

        try {
            const { audio } = await synthesizeAzureTts(text, { voice, rate, volume, pitch });
            return new Response(audio, {
                status: 200,
                headers: {
                    "Content-Type": "audio/mpeg",
                    "Content-Length": String(audio.byteLength),
                    "X-Azure-TTS-Voice": voice,
                    "Cache-Control": "no-store",
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[tts-preview]", message);
            return c.json({ success: false, error: message }, 502);
        }
    }
}
