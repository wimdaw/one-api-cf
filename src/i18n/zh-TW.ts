const zhTW: Record<string, string> = {
    // auth
    "auth.telegramRequired": "Telegram 登入驗證已開啟，請先完成驗證碼登入",
    "auth.unauthorized": "Unauthorized",

    // system
    "system.botTokenRequired": "Bot Token 不能為空",
    "system.chatIdRequired": "Chat ID 不能為空",
    "system.telegramConfigRequired": "開啟 Telegram 驗證前，請先填寫 Bot Token 和 Chat ID",
    "system.configInvalid": "系統設定無效",
    "system.telegramConfigInvalid": "Telegram 配置無效",
    "system.fillBotTokenAndChatId": "請先填寫有效的 Bot Token 和 Chat ID",
    "system.telegramTestFailed": "Telegram 測試訊息傳送失敗：{{error}}",

    // analytics
    "analytics.invalidFormat": "{{field}} 格式無效",
    "analytics.startTime": "開始時間",
    "analytics.endTime": "結束時間",
    "analytics.startBeforeEnd": "開始時間必須早於結束時間",
};

export default zhTW;
