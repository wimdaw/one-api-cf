import { Context } from "hono";
import { getSystemConfig } from "../system-config";

// ---------------------------------------------------------------------------
// 用户认证核心 (one-api 移植, 保持现有风格)
// 角色: 1=普通用户, 10=管理员, 100=超级管理员
// 状态: 1=启用, 2=禁用
// 密码用 Web Crypto 的 PBKDF2 哈希存储 (Workers 环境可用)
// ---------------------------------------------------------------------------

export const ROLE_USER = 1;
export const ROLE_ADMIN = 10;
export const ROLE_ROOT = 100;

export const STATUS_ENABLED = 1;
export const STATUS_DISABLED = 2;

export type UserRow = {
    id: number;
    username: string;
    password_hash: string;
    display_name: string;
    email?: string;
    role: number;
    status: number;
    quota: number;
    used_quota: number;
    inviter_id: number | null;
    aff_code: string | null;
    created_at: string;
    updated_at: string;
};

// ---------- 密码哈希 (PBKDF2-SHA256) ----------
const PBKDF2_ITERATIONS = 100_000;

const bytesToHex = (bytes: Uint8Array): string =>
    Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
};

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
    const encoder = new TextEncoder();
    const salt = saltHex
        ? hexToBytes(saltHex)
        : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        256
    );
    const saltHexStr = bytesToHex(salt);
    const hashHex = bytesToHex(new Uint8Array(bits));
    return { hash: hashHex, salt: saltHexStr };
}

export async function verifyPassword(
    password: string,
    storedHash: string,
    storedSalt: string
): Promise<boolean> {
    try {
        const { hash } = await hashPassword(password, storedSalt);
        return hash === storedHash;
    } catch {
        return false;
    }
}

// ---------- 数据库访问 ----------
export async function findUserByUsername(c: Context<HonoCustomType>, username: string): Promise<UserRow | null> {
    const row = await c.env.DB.prepare(
        "SELECT * FROM users WHERE username = ?"
    ).bind(username).first<UserRow>();
    return row || null;
}

export async function findUserById(c: Context<HonoCustomType>, id: number): Promise<UserRow | null> {
    const row = await c.env.DB.prepare(
        "SELECT * FROM users WHERE id = ?"
    ).bind(id).first<UserRow>();
    return row || null;
}

export async function getBalance(c: Context<HonoCustomType>, user: UserRow): Promise<number> {
    // quota = -1 表示无限额度, 余额为 -1 (无限); 否则取剩余
    if (user.quota === -1) {
        return -1;
    }
    return Math.max(0, user.quota - user.used_quota);
}

export const isAdmin = (user: Pick<UserRow, "role">): boolean => user.role >= ROLE_ADMIN;

export const isEnabled = (user: Pick<UserRow, "status">): boolean => user.status === STATUS_ENABLED;

// ---------- 邀请码 / 返利 ----------
const AFF_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateAffCode(): string {
    let code = "";
    for (let i = 0; i < 8; i += 1) {
        code += AFF_CODE_CHARSET[Math.floor(Math.random() * AFF_CODE_CHARSET.length)];
    }
    return code;
}

// 返回: { quotaForInvitee, quotaForInviter } (来自系统配置)
export async function getInviteQuotas(c: Context<HonoCustomType>): Promise<{ quotaForInvitee: number; quotaForInviter: number }> {
    try {
        const cfg = await getSystemConfig(c);
        return {
            quotaForInvitee: cfg?.invite?.quotaForInvitee || 0,
            quotaForInviter: cfg?.invite?.quotaForInviter || 0,
        };
    } catch {
        return { quotaForInvitee: 0, quotaForInviter: 0 };
    }
}