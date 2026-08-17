import { type AdminSecurityConfig, type ApiDocsConfig, type InviteConfig, type SystemConfig, type WebsiteConfig } from "@/types";
import {
  DEFAULT_BILLING_DISPLAY_DECIMALS,
  normalizeBillingDisplayDecimals,
} from "@/lib/billing";

export const DEFAULT_ADMIN_SECURITY_CONFIG: AdminSecurityConfig = {
  enabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  verifiedFingerprint: "",
  verifiedAt: null,
};

export const DEFAULT_API_DOCS_CONFIG: ApiDocsConfig = {
  enabled: true,
};

export const DEFAULT_INVITE_CONFIG: InviteConfig = {
  quotaForInvitee: 0,
  quotaForInviter: 0,
};

export const DEFAULT_WEBSITE_CONFIG: WebsiteConfig = {
  systemName: "AI Gateway",
  logo: "",
  footer: "",
  homeContent: "",
  allowRegister: true,
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  displayDecimals: DEFAULT_BILLING_DISPLAY_DECIMALS,
  adminSecurity: DEFAULT_ADMIN_SECURITY_CONFIG,
  apiDocs: DEFAULT_API_DOCS_CONFIG,
  invite: DEFAULT_INVITE_CONFIG,
  website: DEFAULT_WEBSITE_CONFIG,
};

export const PRECISION_OPTIONS = [
  { label: "2", value: 2 },
  { label: "4", value: 4 },
  { label: "6", value: 6 },
] as const;

const normalizeString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

export const normalizeAdminSecurityConfig = (value?: Partial<AdminSecurityConfig> | null): AdminSecurityConfig => {
  return {
    enabled: value?.enabled === true,
    telegramBotToken: normalizeString(value?.telegramBotToken),
    telegramChatId: normalizeString(value?.telegramChatId),
    verifiedFingerprint: normalizeString(value?.verifiedFingerprint),
    verifiedAt: typeof value?.verifiedAt === "string" && value.verifiedAt.trim().length > 0
      ? value.verifiedAt.trim()
      : null,
  };
};

export const normalizeApiDocsConfig = (value?: Partial<ApiDocsConfig> | null): ApiDocsConfig => {
  return {
    enabled: value?.enabled ?? DEFAULT_API_DOCS_CONFIG.enabled,
  };
};

export const normalizeInviteConfig = (value?: Partial<InviteConfig> | null): InviteConfig => {
  return {
    quotaForInvitee: typeof value?.quotaForInvitee === "number" && value.quotaForInvitee > 0
      ? value.quotaForInvitee
      : DEFAULT_INVITE_CONFIG.quotaForInvitee,
    quotaForInviter: typeof value?.quotaForInviter === "number" && value.quotaForInviter > 0
      ? value.quotaForInviter
      : DEFAULT_INVITE_CONFIG.quotaForInviter,
  };
};

export const normalizeWebsiteConfig = (value?: Partial<WebsiteConfig> | null): WebsiteConfig => {
  const v = value ?? {};
  return {
    systemName: typeof v.systemName === "string" && v.systemName.trim() ? v.systemName.trim() : DEFAULT_WEBSITE_CONFIG.systemName,
    logo: typeof v.logo === "string" ? v.logo.trim() : "",
    footer: typeof v.footer === "string" ? v.footer.trim() : "",
    homeContent: typeof v.homeContent === "string" ? v.homeContent.trim() : "",
    allowRegister: typeof v.allowRegister === "boolean" ? v.allowRegister : true,
  };
};

export const normalizeSystemConfig = (value?: Partial<SystemConfig> | null): SystemConfig => {
  return {
    displayDecimals: normalizeBillingDisplayDecimals(value?.displayDecimals),
    adminSecurity: normalizeAdminSecurityConfig(value?.adminSecurity),
    apiDocs: normalizeApiDocsConfig(value?.apiDocs),
    invite: normalizeInviteConfig(value?.invite),
    website: normalizeWebsiteConfig(value?.website),
  };
};

export const isTelegramSecurityEnabled = (config?: Partial<AdminSecurityConfig> | null): boolean => {
  return config?.enabled === true
    && typeof config.telegramBotToken === "string"
    && config.telegramBotToken.trim().length > 0
    && typeof config.telegramChatId === "string"
    && config.telegramChatId.trim().length > 0;
};

export const isTelegramSecurityVerified = (config?: Partial<AdminSecurityConfig> | null): boolean => {
  return typeof config?.verifiedFingerprint === "string"
    && config.verifiedFingerprint.trim().length > 0
    && typeof config?.verifiedAt === "string"
    && config.verifiedAt.trim().length > 0;
};

export const clearTelegramSecurityVerification = (
  config: AdminSecurityConfig,
): AdminSecurityConfig => {
  return {
    ...config,
    enabled: false,
    verifiedFingerprint: "",
    verifiedAt: null,
  };
};
