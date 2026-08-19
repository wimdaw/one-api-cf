import { Context } from "hono";

// ---------------------------------------------------------------------------
// 邮件发送模块 (基于 Resend API)
//   - Resend (resend.com): HTTP API, Cloudflare Workers 原生支持, 免费 3000 封/月
//   - 配置存放在 SystemConfig.mail:
//     {
//       provider: "resend",            // resend (默认) | smtp
//       apiKey: "re_xxx",              // Resend API key
//       fromEmail: "no-reply@xxx.com", // 发件人邮箱 (需在 Resend 验证域名)
//       fromName: "AI Gateway",        // 发件人名称
//       // SMTP 备选 (provider="smtp" 时):
//       smtpServer: "", smtpPort: 587, smtpAccount: "", smtpToken: "",
//     }
// ---------------------------------------------------------------------------

export type MailConfig = {
    provider: "resend" | "smtp";
    apiKey: string;
    fromEmail: string;
    fromName: string;
    smtpServer: string;
    smtpPort: number;
    smtpAccount: string;
    smtpToken: string;
};

export const DEFAULT_MAIL_CONFIG: MailConfig = {
    provider: "resend",
    apiKey: "",
    fromEmail: "",
    fromName: "AI Gateway",
    smtpServer: "",
    smtpPort: 587,
    smtpAccount: "",
    smtpToken: "",
};

export const isMailConfigured = (config: Partial<MailConfig> | null | undefined): boolean => {
    if (!config?.fromEmail) return false;
    if (config.provider === "smtp") {
        return Boolean(config.smtpServer);
    }
    return Boolean(config.apiKey);
};

const normalizePort = (value: unknown): number => {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 587;
};

export const normalizeMailConfig = (
    value: Partial<MailConfig> | null | undefined
): MailConfig => {
    const v = value ?? {};
    const str = (x: unknown) => typeof x === "string" ? x.trim() : "";
    return {
        provider: v.provider === "smtp" ? "smtp" : "resend",
        apiKey: str(v.apiKey),
        fromEmail: str(v.fromEmail),
        fromName: str(v.fromName) || DEFAULT_MAIL_CONFIG.fromName,
        smtpServer: str(v.smtpServer),
        smtpPort: normalizePort(v.smtpPort),
        smtpAccount: str(v.smtpAccount),
        smtpToken: str(v.smtpToken),
    };
};

// ---------- Resend API 发送 (Workers/Node 通用, 纯 HTTP) ----------
async function sendViaResend(
    config: MailConfig,
    to: string,
    subject: string,
    htmlBody: string
): Promise<void> {
    const from = config.fromName
        ? `"${config.fromName}" <${config.fromEmail}>`
        : config.fromEmail;

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject,
            html: htmlBody,
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Resend API error (${response.status}): ${errorText.slice(0, 300)}`);
    }
}

// ---------- SMTP 备选 (Node 模式用 nodemailer) ----------
async function sendViaSmtp(
    config: MailConfig,
    to: string,
    subject: string,
    htmlBody: string
): Promise<void> {
    if (typeof process === "undefined" || !process.versions?.node) {
        throw new Error("SMTP provider requires Node runtime (use provider=resend on Workers)");
    }
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
        host: config.smtpServer,
        port: config.smtpPort || 587,
        secure: (config.smtpPort || 587) === 465,
        auth: config.smtpAccount
            ? { user: config.smtpAccount, pass: config.smtpToken }
            : undefined,
    });
    await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to,
        subject,
        html: htmlBody,
    });
}

// 发送邮件
export async function sendEmail(
    c: Context<HonoCustomType>,
    to: string,
    subject: string,
    htmlBody: string
): Promise<void> {
    const { getSystemConfig } = await import("./system-config");
    const systemConfig = await getSystemConfig(c);
    const mailConfig = normalizeMailConfig((systemConfig as any).mail);

    if (!isMailConfigured(mailConfig)) {
        throw new Error("Mail is not configured (set fromEmail + apiKey/resend in system config)");
    }

    if (mailConfig.provider === "smtp") {
        await sendViaSmtp(mailConfig, to, subject, htmlBody);
        return;
    }
    await sendViaResend(mailConfig, to, subject, htmlBody);
}

// 生成 6 位数字验证码
export function generateVerificationCode(): string {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let code = "";
    for (const b of bytes) {
        code += String(b % 10);
    }
    return code;
}

// 验证码哈希 (PBKDF2 与密码一致)
export async function hashVerificationCode(code: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(code),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const salt = crypto.getRandomValues(new Uint8Array(8));
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 10000, hash: "SHA-256" },
        keyMaterial,
        128
    );
    const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${saltHex}:${hashHex}`;
}

export async function verifyVerificationCode(
    code: string,
    storedHash: string
): Promise<boolean> {
    const [saltHex, expectedHex] = storedHash.split(":");
    if (!saltHex || !expectedHex) return false;
    const encoder = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(code),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 10000, hash: "SHA-256" },
        keyMaterial,
        128
    );
    const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex === expectedHex;
}
