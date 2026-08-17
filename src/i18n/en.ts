const en: Record<string, string> = {
    // auth
    "auth.telegramRequired": "Telegram login verification is enabled. Please complete verification first",
    "auth.unauthorized": "Unauthorized",

    // system
    "system.botTokenRequired": "Bot Token cannot be empty",
    "system.chatIdRequired": "Chat ID cannot be empty",
    "system.telegramConfigRequired": "Please fill in Bot Token and Chat ID before enabling Telegram verification",
    "system.configInvalid": "Invalid system configuration",
    "system.telegramConfigInvalid": "Invalid Telegram configuration",
    "system.fillBotTokenAndChatId": "Please fill in a valid Bot Token and Chat ID first",
    "system.telegramTestFailed": "Telegram test message failed: {{error}}",

    // analytics
    "analytics.invalidFormat": "{{field}} has invalid format",
    "analytics.startTime": "Start time",
    "analytics.endTime": "End time",
    "analytics.startBeforeEnd": "Start time must be earlier than end time",
};

export default en;
