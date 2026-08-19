import { Hono } from "hono"
import { fromHono } from 'chanfana';
import { DBInitializeEndpoint } from "./db_api"
import db from "../db"
import {
    ChannelGetEndpoint, ChannelUpsertEndpoint, ChannelDeleteEndpoint, ChannelFetchModelsEndpoint, ChannelTestModelEndpoint, deleteDisabledChannels
} from "./channel_api"
import {
    TokenListEndpoint, TokenUpsertEndpoint, TokenDeleteEndpoint, TokenResetUsageEndpoint
} from "./token_api"
import {
    PricingGetEndpoint, PricingUpdateEndpoint
} from "./pricing_api"
import {
    BillingConfigGetEndpoint, BillingConfigUpdateEndpoint
} from "./billing_api"
import {
    AdminTopUpEndpoint, TopUpRecordListEndpoint
} from "./billing_api"
import {
    GroupListEndpoint,
    GroupCreateEndpoint,
    GroupDeleteEndpoint,
    GroupSetUserEndpoint,
    GroupSetChannelEndpoint,
    GroupGetChannelEndpoint,
} from "./group_api"
import {
    SystemConfigGetEndpoint,
    SystemConfigUpdateEndpoint,
    TelegramTestMessageEndpoint,
    MailTestEndpoint,
} from "./system_api"
import {
    AdminLoginStartEndpoint,
    AdminLoginVerifyEndpoint,
    AdminLogoutEndpoint,
} from "./auth_api"
import {
    AnalyticsOverviewEndpoint,
    AnalyticsTrendEndpoint,
    AnalyticsBreakdownEndpoint,
    AnalyticsEventsEndpoint,
    UsageLogSearchEndpoint,
} from "./analytics_api"
import {
    LogStatEndpoint,
    LogCleanupEndpoint,
    AdminLogSearchEndpoint,
} from "./log_api"
import {
    UserListEndpoint,
    UserCreateEndpoint,
    UserUpdateEndpoint,
    UserDeleteEndpoint,
    UserSelfEndpoint,
    UserManageEndpoint,
} from "./user_api"
import {
    UserRegisterEndpoint,
    UserLoginEndpoint,
    UserLogoutEndpoint,
} from "./user_auth_api"
import {
    RedemptionCreateEndpoint,
    RedemptionListEndpoint,
    RedemptionDeleteEndpoint,
} from "./redemption_api"
import {
    InviteCodeCreateEndpoint,
    InviteCodeListEndpoint,
    InviteCodeDeleteEndpoint,
} from "./invite_code_api"
import { getSystemConfig, isTelegramSecurityEnabled } from "../system-config"
import { t } from "../i18n"
import { CONSTANTS } from "../constants"
import {
    SendVerificationEndpoint,
    SendResetPasswordEndpoint,
    ResetPasswordEndpoint,
    VerifyEmailEndpoint,
    BindEmailEndpoint,
} from "../email_api"
import {
    clearAdminSessionCookie,
    getAdminSessionTokenFromRequest,
    validateAdminSession,
} from "./auth_shared"
import { findUserById, isAdmin } from "../user/auth"
import { registerUserApi } from "../user/routes"

const app = new Hono<HonoCustomType>()
export const api = fromHono(app)

const PUBLIC_AUTH_ROUTES = new Set([
    "/api/admin/auth/login",
    "/api/admin/auth/verify",
    "/api/admin/user/register",
    "/api/admin/user/login",
    "/api/system/config",
]);

app.use('/api/admin/*', async (c, next) => {
    await db.ensureReady(c);
    await next();
});

// Authentication Middleware - using environment variable or admin session
app.use('/api/admin/*', async (c, next) => {
    if (PUBLIC_AUTH_ROUTES.has(c.req.path)) {
        await next();
        return;
    }

    const sessionToken = getAdminSessionTokenFromRequest(c);

    if (sessionToken) {
        const sessionUserId = await validateAdminSession(c, sessionToken);
        if (sessionUserId !== null) {
            // 用户会话: 仅管理员用户可访问管理后台
            if (sessionUserId > 0) {
                const user = await findUserById(c, sessionUserId);
                if (user && user.status === 1 && isAdmin(user)) {
                    c.set("user", user);
                    await next();
                    return;
                }
                clearAdminSessionCookie(c);
            } else {
                // 纯管理员会话 (ADMIN_TOKEN 登录, 无 user_id) 保持兼容
                c.set("user", null);
                await next();
                return;
            }
        }

        clearAdminSessionCookie(c);
    }

    const systemConfig = await getSystemConfig(c);
    const securityEnabled = isTelegramSecurityEnabled(systemConfig.adminSecurity);
    const token = c.req.header('x-admin-token');
    const adminToken = c.env.ADMIN_TOKEN;

    if (!securityEnabled && token && adminToken && token === adminToken) {
        await next();
        return;
    }

    return c.text(
        securityEnabled
            ? t(c.get('lang') || 'zh-CN', 'auth.telegramRequired')
            : t(c.get('lang') || 'zh-CN', 'auth.unauthorized'),
        401
    );
});

api.post("/api/admin/db_initialize", DBInitializeEndpoint)

// 用户认证路由 (公开: 注册/登录) - 用 Hono 原生挂载
app.post("/api/admin/user/register", UserRegisterEndpoint.handler)
app.post("/api/admin/user/login", UserLoginEndpoint.handler)
app.post("/api/admin/user/logout", UserLogoutEndpoint.handler)

// 邮箱路由 (公开: 发验证码/重置邮件)
app.get("/api/verification", SendVerificationEndpoint.handler)
app.get("/api/reset_password", SendResetPasswordEndpoint.handler)
app.post("/api/user/reset", ResetPasswordEndpoint.handler)

// Authentication routes
api.post("/api/admin/auth/login", AdminLoginStartEndpoint)
api.post("/api/admin/auth/verify", AdminLoginVerifyEndpoint)
api.post("/api/admin/auth/logout", AdminLogoutEndpoint)

api.get("/api/admin/channel", ChannelGetEndpoint)
api.post("/api/admin/channel/:key", ChannelUpsertEndpoint)
api.delete("/api/admin/channel/:key", ChannelDeleteEndpoint)
api.post("/api/admin/channel/models/fetch", ChannelFetchModelsEndpoint)
api.post("/api/admin/channel/models/test", ChannelTestModelEndpoint)

// Token management routes
api.get("/api/admin/token", TokenListEndpoint)
api.post("/api/admin/token/:key", TokenUpsertEndpoint)
api.post("/api/admin/token/:key/reset", TokenResetUsageEndpoint)
api.delete("/api/admin/token/:key", TokenDeleteEndpoint)

// Pricing management routes
api.get("/api/admin/pricing", PricingGetEndpoint)
api.post("/api/admin/pricing", PricingUpdateEndpoint)
api.get("/api/admin/billing/config", BillingConfigGetEndpoint)
api.post("/api/admin/billing/config", BillingConfigUpdateEndpoint)
api.post("/api/admin/topup", AdminTopUpEndpoint)
api.get("/api/admin/topup/records", TopUpRecordListEndpoint)
api.get("/api/admin/system/config", SystemConfigGetEndpoint)
api.post("/api/admin/system/config", SystemConfigUpdateEndpoint)
api.post("/api/admin/system/telegram/test", TelegramTestMessageEndpoint)
api.post("/api/admin/system/mail/test", MailTestEndpoint)

// Analytics management routes
api.get("/api/admin/analytics/overview", AnalyticsOverviewEndpoint)
api.get("/api/admin/analytics/trend", AnalyticsTrendEndpoint)
api.get("/api/admin/analytics/breakdown", AnalyticsBreakdownEndpoint)
api.get("/api/admin/analytics/events", AnalyticsEventsEndpoint)
api.get("/api/admin/usage-logs", UsageLogSearchEndpoint)

// 日志系统路由 (移植自 one-api: 统计/清理/搜索)
api.get("/api/admin/log/stat", LogStatEndpoint)
api.delete("/api/admin/log", LogCleanupEndpoint)
api.get("/api/admin/log/search", AdminLogSearchEndpoint)

// 用户组路由 (移植自 one-api: group)
api.get("/api/admin/group", GroupListEndpoint)
api.post("/api/admin/group", GroupCreateEndpoint)
api.delete("/api/admin/group/:name", GroupDeleteEndpoint)
api.post("/api/admin/group/user", GroupSetUserEndpoint)
api.post("/api/admin/group/channel/:key", GroupSetChannelEndpoint)
api.get("/api/admin/group/channel/:key", GroupGetChannelEndpoint)

// User management routes (admin) - Hono 原生
app.get("/api/admin/user", UserListEndpoint.handler)
app.post("/api/admin/user", UserCreateEndpoint.handler)
app.get("/api/admin/user/self", UserSelfEndpoint.handler)
app.put("/api/admin/user/:id", UserUpdateEndpoint.handler)
app.delete("/api/admin/user/:id", UserDeleteEndpoint.handler)
app.post("/api/admin/user/manage", UserManageEndpoint.handler)

// Channel management routes
app.delete("/api/admin/channel/disabled", deleteDisabledChannels)

// 用户自助路由 (/api/user/*): 登录即可访问, 不要求管理员
registerUserApi(app)

// 兑换码管理路由 (admin)
app.get("/api/admin/redemption", RedemptionListEndpoint.handler)
app.post("/api/admin/redemption", RedemptionCreateEndpoint.handler)
app.delete("/api/admin/redemption/:id", RedemptionDeleteEndpoint.handler)
app.get("/api/admin/invite-code", InviteCodeListEndpoint.handler)
app.post("/api/admin/invite-code", InviteCodeCreateEndpoint.handler)
app.delete("/api/admin/invite-code/:id", InviteCodeDeleteEndpoint.handler)

// 公开网站配置 (未登录可读, 用于首页展示站名/Logo)
app.get("/api/system/config", async (c) => {
    const systemConfig = await getSystemConfig(c);
    return c.json({
        success: true,
        data: {
            website: systemConfig.website || {},
        },
    });
})

// 公开站点信息 (移植自 one-api: notice/about/home_page_content/status)
app.get("/api/notice", async (c) => {
    const systemConfig = await getSystemConfig(c);
    return c.json({ success: true, data: systemConfig.website?.notice || "" });
})

app.get("/api/about", async (c) => {
    const systemConfig = await getSystemConfig(c);
    return c.json({ success: true, data: systemConfig.website?.about || "" });
})

app.get("/api/home_page_content", async (c) => {
    const systemConfig = await getSystemConfig(c);
    return c.json({ success: true, data: systemConfig.website?.homeContent || "" });
})

app.get("/api/status", async (c) => {
    const systemConfig = await getSystemConfig(c);
    const mail = systemConfig.mail;
    return c.json({
        success: true,
        data: {
            version: CONSTANTS.VERSION,
            email_verification: Boolean(mail?.fromEmail && (mail.apiKey || mail.smtpServer)),
            allow_register: systemConfig.website?.allowRegister !== false,
        },
    });
})
