import { Context } from "hono";

import { sendEmail, generateVerificationCode, hashVerificationCode, verifyVerificationCode } from "./mail";
import { getSystemConfig } from "./system-config";
import { findUserById, hashPassword, type UserRow } from "./user/auth";

// ---------------------------------------------------------------------------
// 邮箱功能 (移植自 one-api: 邮箱验证/密码重置/绑定)
//   - GET  /api/verification?email=xxx      发送邮箱验证码
//   - GET  /api/reset_password?email=xxx    发送密码重置邮件
//   - POST /api/user/reset                  验证码 + 新密码重置
//   - POST /api/user/email/verify           验证码验证邮箱
//   - POST /api/user/email/bind             绑定邮箱
// 验证码存 email_verification 表 (purpose: verify/reset), 10 分钟有效
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

type VerificationRow = {
    id: number;
    email: string;
    code_hash: string;
    purpose: string;
    expires_at: string;
    attempts: number;
    max_attempts: number;
    created_at: string;
};

// 查找用户 (by email, 大小写不敏感)
async function findUserByEmail(c: Context<HonoCustomType>, email: string): Promise<UserRow | null> {
    const row = await c.env.DB.prepare(
        "SELECT * FROM users WHERE LOWER(email) = LOWER(?)"
    ).bind(email).first<UserRow>();
    return row || null;
}

// 发送验证码: purpose = verify | reset
async function sendVerificationCode(
    c: Context<HonoCustomType>,
    email: string,
    purpose: "verify" | "reset"
): Promise<{ sent: boolean; reason?: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { sent: false, reason: "invalid_email" };
    }

    const systemConfig = await getSystemConfig(c);
    const mailConfig = systemConfig.mail;
    if (!mailConfig?.fromEmail || !(mailConfig.apiKey || mailConfig.smtpServer)) {
        return { sent: false, reason: "mail_not_configured" };
    }

    // 冷却: 同一邮箱 60 秒内只能发一次
    const recent = await c.env.DB.prepare(
        `SELECT created_at FROM email_verification
         WHERE email = ? AND purpose = ?
         ORDER BY id DESC LIMIT 1`
    ).bind(normalizedEmail, purpose).first<{ created_at: string }>();
    if (recent?.created_at) {
        const lastSent = Date.parse(recent.created_at.replace(" ", "T") + "Z");
        if (!Number.isNaN(lastSent) && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
            return { sent: false, reason: "too_frequent" };
        }
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    // 清理旧记录并插入新验证码
    await c.env.DB.prepare(
        `DELETE FROM email_verification WHERE email = ? AND purpose = ?`
    ).bind(normalizedEmail, purpose).run();
    await c.env.DB.prepare(
        `INSERT INTO email_verification (email, code_hash, purpose, expires_at, attempts, max_attempts)
         VALUES (?, ?, ?, ?, 0, ?)`
    ).bind(normalizedEmail, codeHash, purpose, expiresAt, CODE_MAX_ATTEMPTS).run();

    const systemName = systemConfig.website?.systemName || "AI Gateway";
    const subject = purpose === "reset"
        ? `[${systemName}] Password Reset Code`
        : `[${systemName}] Email Verification Code`;
    const html = `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h2 style="color: #111827; margin: 0 0 16px;">${purpose === "reset" ? "Reset Your Password" : "Verify Your Email"}</h2>
  <p style="color: #374151; font-size: 14px; line-height: 1.6;">Your verification code is:</p>
  <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; color: #2563eb; padding: 16px; background: #f3f4f6; border-radius: 8px; margin: 16px 0;">${code}</div>
  <p style="color: #6b7280; font-size: 12px; line-height: 1.6;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
</div>`;

    try {
        await sendEmail(c, normalizedEmail, subject, html);
        return { sent: true };
    } catch (error) {
        console.error("[mail] Failed to send email:", error);
        // 发送失败删除验证码, 避免无效码被使用
        await c.env.DB.prepare(
            `DELETE FROM email_verification WHERE email = ? AND purpose = ?`
        ).bind(normalizedEmail, purpose).run();
        return { sent: false, reason: "send_failed" };
    }
}

// 校验验证码
async function verifyCode(
    c: Context<HonoCustomType>,
    email: string,
    code: string,
    purpose: "verify" | "reset"
): Promise<{ ok: boolean; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const row = await c.env.DB.prepare(
        `SELECT * FROM email_verification
         WHERE email = ? AND purpose = ?
         ORDER BY id DESC LIMIT 1`
    ).bind(normalizedEmail, purpose).first<VerificationRow>();

    if (!row) {
        return { ok: false, error: "No verification code found. Request a new one." };
    }

    const expiresAt = Date.parse(row.expires_at);
    if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
        await c.env.DB.prepare(`DELETE FROM email_verification WHERE id = ?`).bind(row.id).run();
        return { ok: false, error: "Verification code expired. Request a new one." };
    }

    if ((row.attempts || 0) >= (row.max_attempts || CODE_MAX_ATTEMPTS)) {
        await c.env.DB.prepare(`DELETE FROM email_verification WHERE id = ?`).bind(row.id).run();
        return { ok: false, error: "Too many attempts. Request a new code." };
    }

    const valid = await verifyVerificationCode(code.trim(), row.code_hash);
    if (!valid) {
        await c.env.DB.prepare(
            `UPDATE email_verification SET attempts = attempts + 1 WHERE id = ?`
        ).bind(row.id).run();
        return { ok: false, error: "Invalid verification code." };
    }

    // 成功后删除验证码 (一次性)
    await c.env.DB.prepare(`DELETE FROM email_verification WHERE id = ?`).bind(row.id).run();
    return { ok: true };
}

// ---------- 接口 ----------

// GET /api/verification?email=xxx - 发送邮箱验证码 (用于注册/绑定)
export const SendVerificationEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const email = c.req.query("email") || "";
        const result = await sendVerificationCode(c, email, "verify");
        if (!result.sent) {
            const reasons: Record<string, string> = {
                invalid_email: "Invalid email address",
                mail_not_configured: "Mail is not configured",
                too_frequent: "Please wait 60 seconds before requesting another code",
                send_failed: "Failed to send email",
            };
            return c.json({ success: false, error: reasons[result.reason || ""] || "Failed" }, 400);
        }
        return c.json({ success: true, data: { sent: true, expires_in: CODE_TTL_MS / 1000 } });
    },
};

// GET /api/reset_password?email=xxx - 发送密码重置邮件
export const SendResetPasswordEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const email = c.req.query("email") || "";
        const user = await findUserByEmail(c, email.trim().toLowerCase());
        // 用户不存在也返回成功, 避免邮箱枚举
        if (!user) {
            return c.json({ success: true, data: { sent: false } });
        }
        const result = await sendVerificationCode(c, email, "reset");
        if (!result.sent) {
            const reasons: Record<string, string> = {
                invalid_email: "Invalid email address",
                mail_not_configured: "Mail is not configured",
                too_frequent: "Please wait 60 seconds before requesting another code",
                send_failed: "Failed to send email",
            };
            return c.json({ success: false, error: reasons[result.reason || ""] || "Failed" }, 400);
        }
        return c.json({ success: true, data: { sent: true, expires_in: CODE_TTL_MS / 1000 } });
    },
};

// POST /api/user/reset {email, code, password} - 验证码重置密码
export const ResetPasswordEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const body = await c.req.json().catch(() => ({}));
        const email = String(body.email || "").trim().toLowerCase();
        const code = String(body.code || "").trim();
        const password = String(body.password || "");

        if (!email || !code || password.length < 6) {
            return c.json({ success: false, error: "email, code and password (min 6 chars) are required" }, 400);
        }

        const check = await verifyCode(c, email, code, "reset");
        if (!check.ok) {
            return c.json({ success: false, error: check.error }, 400);
        }

        const user = await findUserByEmail(c, email);
        if (!user) {
            return c.json({ success: false, error: "User not found" }, 404);
        }

        const { hash, salt } = await hashPassword(password);
        await c.env.DB.prepare(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(`${salt}:${hash}`, user.id).run();

        return c.json({ success: true, data: { reset: true } });
    },
};

// POST /api/user/email/verify {code} - 验证当前登录用户邮箱
export const VerifyEmailEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const user = (c as any).user as UserRow;
        if (!user) {
            return c.json({ success: false, error: "Unauthorized" }, 401);
        }
        if (!user.email) {
            return c.json({ success: false, error: "No email bound to this account" }, 400);
        }

        const body = await c.req.json().catch(() => ({}));
        const code = String(body.code || "").trim();
        if (!code) {
            return c.json({ success: false, error: "code is required" }, 400);
        }

        const check = await verifyCode(c, user.email, code, "verify");
        if (!check.ok) {
            return c.json({ success: false, error: check.error }, 400);
        }

        await c.env.DB.prepare(
            "UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(user.id).run();

        return c.json({ success: true, data: { verified: true } });
    },
};

// POST /api/user/email/bind {email} - 绑定邮箱 (需先获取验证码)
export const BindEmailEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const user = (c as any).user as UserRow;
        if (!user) {
            return c.json({ success: false, error: "Unauthorized" }, 401);
        }

        const body = await c.req.json().catch(() => ({}));
        const email = String(body.email || "").trim().toLowerCase();
        const code = String(body.code || "").trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return c.json({ success: false, error: "Invalid email address" }, 400);
        }
        if (!code) {
            return c.json({ success: false, error: "code is required" }, 400);
        }

        // 邮箱已被其他用户占用
        const existing = await findUserByEmail(c, email);
        if (existing && existing.id !== user.id) {
            return c.json({ success: false, error: "Email already in use" }, 409);
        }

        const check = await verifyCode(c, email, code, "verify");
        if (!check.ok) {
            return c.json({ success: false, error: check.error }, 400);
        }

        await c.env.DB.prepare(
            "UPDATE users SET email = ?, email_verified = 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(email, user.id).run();

        return c.json({ success: true, data: { bound: true, email } });
    },
};
