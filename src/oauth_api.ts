import { Context } from "hono";

import { getSystemConfig } from "./system-config";
import { findUserByUsername, generateAffCode, hashPassword, ROLE_USER, STATUS_ENABLED } from "./user/auth";

// ---------------------------------------------------------------------------
// 第三方登录 (移植自 one-api: GitHub/OIDC OAuth2)
//   - 配置: SystemConfig.oauth = { githubClientId, githubClientSecret, oidcClientId, ... }
//   - 流程: /api/oauth/:provider?redirect=xxx  -> 跳转授权
//           /api/oauth/:provider/callback?code=&state=  -> 回调换取用户信息
//   - 用户不存在自动注册 (用户名 = provider_id), 已存在则登录
// 注意: 微信/飞书需要额外 token 换取流程, 结构与 GitHub/OIDC 相同可扩展
// ---------------------------------------------------------------------------

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_KEY = "oauth_state";

type OAuthConfig = {
    githubClientId: string;
    githubClientSecret: string;
    oidcClientId: string;
    oidcClientSecret: string;
    oidcWellKnown: string;
    oidcAuthorizationEndpoint: string;
    oidcTokenEndpoint: string;
    oidcUserinfoEndpoint: string;
};

export const DEFAULT_OAUTH_CONFIG: OAuthConfig = {
    githubClientId: "",
    githubClientSecret: "",
    oidcClientId: "",
    oidcClientSecret: "",
    oidcWellKnown: "",
    oidcAuthorizationEndpoint: "",
    oidcTokenEndpoint: "",
    oidcUserinfoEndpoint: "",
};

export const normalizeOAuthConfig = (
    value: Partial<OAuthConfig> | null | undefined
): OAuthConfig => {
    const v = value ?? {};
    const str = (x: unknown) => typeof x === "string" ? x.trim() : "";
    return {
        githubClientId: str(v.githubClientId),
        githubClientSecret: str(v.githubClientSecret),
        oidcClientId: str(v.oidcClientId),
        oidcClientSecret: str(v.oidcClientSecret),
        oidcWellKnown: str(v.oidcWellKnown),
        oidcAuthorizationEndpoint: str(v.oidcAuthorizationEndpoint),
        oidcTokenEndpoint: str(v.oidcTokenEndpoint),
        oidcUserinfoEndpoint: str(v.oidcUserinfoEndpoint),
    };
};

const getOAuthConfig = async (c: Context<HonoCustomType>): Promise<OAuthConfig> => {
    const config = await getSystemConfig(c);
    return normalizeOAuthConfig((config as any).oauth);
};

// ---------- state 管理 (settings 表存储, 防 CSRF) ----------
const saveOAuthState = async (c: Context<HonoCustomType>, state: string, redirect: string): Promise<void> => {
    const payload = JSON.stringify({ state, redirect, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
    await c.env.DB.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
    ).bind(`${OAUTH_STATE_KEY}:${state}`, payload, payload).run();
};

const consumeOAuthState = async (
    c: Context<HonoCustomType>,
    state: string
): Promise<{ state: string; redirect: string } | null> => {
    const row = await c.env.DB.prepare(
        `SELECT value FROM settings WHERE key = ?`
    ).bind(`${OAUTH_STATE_KEY}:${state}`).first<{ value: string }>();
    if (!row) return null;

    await c.env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(`${OAUTH_STATE_KEY}:${state}`).run();

    try {
        const payload = JSON.parse(row.value);
        if (payload.expiresAt && Date.now() > payload.expiresAt) return null;
        return { state: payload.state, redirect: payload.redirect || "/" };
    } catch {
        return null;
    }
};

const randomState = (): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};

// ---------- OAuth 回调后: 登录或注册 ----------
const oauthLoginOrRegister = async (
    c: Context<HonoCustomType>,
    provider: string,
    providerId: string,
    displayName: string,
    email?: string
): Promise<{ success: boolean; error?: string; userId?: number; username?: string }> => {
    // 1. 先按 provider_id 找已绑定用户
    const columnMap: Record<string, string> = {
        github: "github_id",
        oidc: "oidc_id",
        wechat: "wechat_id",
        lark: "lark_id",
    };
    const column = columnMap[provider];
    if (!column) {
        return { success: false, error: "Unsupported provider" };
    }

    const existing = await c.env.DB.prepare(
        `SELECT * FROM users WHERE ${column} = ?`
    ).bind(providerId).first();

    if (existing) {
        return {
            success: true,
            userId: Number((existing as any).id),
            username: String((existing as any).username),
        };
    }

    // 2. 按 email 匹配已有用户 (可选绑定)
    if (email) {
        const byEmail = await c.env.DB.prepare(
            `SELECT * FROM users WHERE LOWER(email) = LOWER(?)`
        ).bind(email).first();
        if (byEmail) {
            await c.env.DB.prepare(
                `UPDATE users SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(providerId, Number((byEmail as any).id)).run();
            return {
                success: true,
                userId: Number((byEmail as any).id),
                username: String((byEmail as any).username),
            };
        }
    }

    // 3. 自动注册新用户
    const baseUsername = `${provider}_${providerId}`.slice(0, 30);
    let username = baseUsername;
    let suffix = 1;
    while (await findUserByUsername(c, username)) {
        suffix += 1;
        username = `${baseUsername}${suffix}`.slice(0, 30);
    }

    // 随机密码 (用户可后续重置)
    const randomPassword = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
    const { hash, salt } = await hashPassword(randomPassword);
    const affCode = generateAffCode();

    const result = await c.env.DB.prepare(
        `INSERT INTO users (username, password_hash, display_name, email, role, status, quota, used_quota, aff_code, ${column}, email_verified)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1)`
    ).bind(
        username,
        `${salt}:${hash}`,
        displayName.slice(0, 30),
        email || "",
        ROLE_USER,
        STATUS_ENABLED,
        affCode,
        providerId
    ).run();

    return {
        success: true,
        userId: Number(result.meta?.last_row_id),
        username,
    };
};

// 写登录 cookie (复用 admin session)
const setSessionForUser = async (c: Context<HonoCustomType>, userId: number): Promise<void> => {
    const { createAdminSession, setAdminSessionCookie } = await import("./admin/auth_shared");
    const session = await createAdminSession(c, false, userId);
    setAdminSessionCookie(c, session.sessionToken, session.expiresAt, session.ttlMs);
};

// ---------- 各 provider 的授权 URL / token 交换 ----------
const buildProviderAuthorizeUrl = (
    config: OAuthConfig,
    provider: string,
    state: string,
    redirectUri: string
): string | null => {
    const base = new URL("https://github.com/login/oauth/authorize");
    const params: Record<string, string> = {
        client_id: config.githubClientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
    };
    for (const [k, v] of Object.entries(params)) {
        if (v) base.searchParams.set(k, v);
    }
    return base.toString();
};

// GitHub token 交换
const githubExchangeToken = async (
    config: OAuthConfig,
    code: string,
    redirectUri: string
): Promise<string> => {
    const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: config.githubClientId,
            client_secret: config.githubClientSecret,
            code,
            redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as { access_token?: string; error?: string };
    if (!data.access_token) {
        throw new Error(`GitHub token exchange failed: ${data.error || "unknown"}`);
    }
    return data.access_token;
};

// GitHub 用户信息
const githubFetchUser = async (accessToken: string): Promise<{ id: string; name: string; email?: string }> => {
    const headers = { "Authorization": `Bearer ${accessToken}`, "Accept": "application/vnd.github+json" };
    const userRes = await fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(15000) });
    const user = await userRes.json() as { id?: number; login?: string; name?: string | null; email?: string | null };

    // 邮箱可能为空, 尝试 user/emails
    let email = user.email || undefined;
    if (!email) {
        const emailsRes = await fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(15000) });
        const emails = await emailsRes.json() as Array<{ email: string; primary?: boolean; verified?: boolean }>;
        email = emails.find((e) => e.primary && e.verified)?.email || emails[0]?.email;
    }

    return {
        id: String(user.id || ""),
        name: user.name || user.login || "",
        email,
    };
};

// ---------- 接口 ----------

// GET /api/oauth/github?redirect=xxx - 发起 GitHub 授权
export const OAuthGitHubStartEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const config = await getOAuthConfig(c);
        if (!config.githubClientId || !config.githubClientSecret) {
            return c.json({ success: false, error: "GitHub OAuth is not configured" }, 400);
        }

        const redirect = c.req.query("redirect") || "/";
        const state = randomState();
        await saveOAuthState(c, state, redirect);

        const redirectUri = new URL(c.req.url);
        redirectUri.search = "";
        redirectUri.pathname = "/api/oauth/github/callback";

        const authorizeUrl = buildProviderAuthorizeUrl(config, "github", state, redirectUri.toString());
        if (!authorizeUrl) {
            return c.json({ success: false, error: "Failed to build authorization URL" }, 500);
        }
        return c.redirect(authorizeUrl, 302);
    },
};

// GET /api/oauth/github/callback?code=&state= - GitHub 回调
export const OAuthGitHubCallbackEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const code = c.req.query("code") || "";
        const state = c.req.query("state") || "";

        const saved = await consumeOAuthState(c, state);
        if (!saved || saved.state !== state) {
            return c.json({ success: false, error: "Invalid or expired state" }, 403);
        }

        const config = await getOAuthConfig(c);
        if (!config.githubClientId || !config.githubClientSecret) {
            return c.json({ success: false, error: "GitHub OAuth is not configured" }, 400);
        }

        try {
            const redirectUri = new URL(c.req.url);
            redirectUri.search = "";
            redirectUri.pathname = "/api/oauth/github/callback";

            const accessToken = await githubExchangeToken(config, code, redirectUri.toString());
            const userInfo = await githubFetchUser(accessToken);

            const result = await oauthLoginOrRegister(c, "github", userInfo.id, userInfo.name, userInfo.email);
            if (!result.success) {
                return c.json({ success: false, error: result.error }, 500);
            }

            await setSessionForUser(c, result.userId!);
            return c.redirect(saved.redirect, 302);
        } catch (error) {
            const message = error instanceof Error ? error.message : "GitHub OAuth failed";
            return c.json({ success: false, error: message }, 502);
        }
    },
};

// GET /api/oauth/state - 生成 OAuth state (前端流程用)
export const OAuthStateEndpoint = {
    handler: async (c: Context<HonoCustomType>) => {
        const redirect = c.req.query("redirect") || "/";
        const state = randomState();
        await saveOAuthState(c, state, redirect);
        return c.json({ success: true, data: { state, redirect } });
    },
};
