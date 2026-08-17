const zhCN: Record<string, string> = {
    // auth
    "auth.telegramRequired": "Telegram 登录验证已开启，请先完成验证码登录",
    "auth.unauthorized": "Unauthorized",

    // system
    "system.botTokenRequired": "Bot Token 不能为空",
    "system.chatIdRequired": "Chat ID 不能为空",
    "system.telegramConfigRequired": "开启 Telegram 验证前，请先填写 Bot Token 和 Chat ID",
    "system.configInvalid": "系统设置无效",
    "system.telegramConfigInvalid": "Telegram 配置无效",
    "system.fillBotTokenAndChatId": "请先填写有效的 Bot Token 和 Chat ID",
    "system.telegramTestFailed": "Telegram 测试消息发送失败：{{error}}",

    // analytics
    "analytics.invalidFormat": "{{field}} 格式无效",
    "analytics.startTime": "开始时间",
    "analytics.endTime": "结束时间",
    "analytics.startBeforeEnd": "开始时间必须早于结束时间",
};

export default zhCN;
