// Azure TTS 全量音色清单 (按语言分组, 含中文显示名)
// 数据源: 微软 Azure 语音服务公开音色列表 (2025-06)
// 格式: { voice: "xx-YY-NameNeural", label: "显示名", locale: "xx-YY" }
export interface AzureTtsVoice {
  voice: string;
  label: string;
  locale: string;
}

export const AZURE_TTS_VOICES: AzureTtsVoice[] = [
  // ===== 中文 (普通话) =====
  { voice: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoyiNeural", label: "晓伊 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-YunjianNeural", label: "云健 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunxiNeural", label: "云希 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunxiaNeural", label: "云夏 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunyangNeural", label: "云扬 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-liaoning-XiaobeiNeural", label: "晓北 · 辽宁女声", locale: "zh-CN-liaoning" },
  { voice: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮 · 陕西女声", locale: "zh-CN-shaanxi" },
  { voice: "zh-CN-XiaochenNeural", label: "晓辰 · 童声", locale: "zh-CN" },
  { voice: "zh-CN-XiaohanNeural", label: "晓涵 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaomengNeural", label: "晓萌 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaomoNeural", label: "晓墨 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoqiuNeural", label: "晓秋 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoruiNeural", label: "晓睿 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoshuangNeural", label: "晓双 · 童声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoxuanNeural", label: "晓萱 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoyanNeural", label: "晓颜 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-XiaoyouNeural", label: "晓悠 · 童声", locale: "zh-CN" },
  { voice: "zh-CN-XiaozhenNeural", label: "晓甄 · 女声", locale: "zh-CN" },
  { voice: "zh-CN-YunfengNeural", label: "云枫 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunhaoNeural", label: "云皓 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunhaoMultilingualNeural", label: "云皓 · 多语言男声", locale: "zh-CN" },
  { voice: "zh-CN-YunjieNeural", label: "云杰 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunzeNeural", label: "云泽 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunfanNeural", label: "云帆 · 男声", locale: "zh-CN" },
  { voice: "zh-CN-YunchenMultilingualNeural", label: "云辰 · 多语言男声", locale: "zh-CN" },
  { voice: "zh-CN-YunxiaMultilingualNeural", label: "云夏 · 多语言男声", locale: "zh-CN" },
  { voice: "zh-CN-YunyeMultilingualNeural", label: "云野 · 多语言男声", locale: "zh-CN" },
  // ===== 中文 (粤语) =====
  { voice: "zh-HK-HiuGaaiNeural", label: "曉佳 · 粤语女声", locale: "zh-HK" },
  { voice: "zh-HK-HiuMaanNeural", label: "曉曼 · 粤语女声", locale: "zh-HK" },
  { voice: "zh-HK-WanLungNeural", label: "雲龍 · 粤语男声", locale: "zh-HK" },
  // ===== 中文 (台湾) =====
  { voice: "zh-TW-HsiaoChenNeural", label: "曉臻 · 台湾女声", locale: "zh-TW" },
  { voice: "zh-TW-HsiaoYuNeural", label: "曉雨 · 台湾女声", locale: "zh-TW" },
  { voice: "zh-TW-YunJheNeural", label: "雲哲 · 台湾男声", locale: "zh-TW" },
  // ===== English (US) =====
  { voice: "en-US-AvaNeural", label: "Ava · 女声", locale: "en-US" },
  { voice: "en-US-AndrewNeural", label: "Andrew · 男声", locale: "en-US" },
  { voice: "en-US-EmmaNeural", label: "Emma · 女声", locale: "en-US" },
  { voice: "en-US-BrianNeural", label: "Brian · 男声", locale: "en-US" },
  { voice: "en-US-JennyNeural", label: "Jenny · 女声", locale: "en-US" },
  { voice: "en-US-GuyNeural", label: "Guy · 男声", locale: "en-US" },
  { voice: "en-US-AriaNeural", label: "Aria · 女声", locale: "en-US" },
  { voice: "en-US-ChristopherNeural", label: "Christopher · 男声", locale: "en-US" },
  { voice: "en-US-EricNeural", label: "Eric · 男声", locale: "en-US" },
  { voice: "en-US-MichelleNeural", label: "Michelle · 女声", locale: "en-US" },
  { voice: "en-US-RogerNeural", label: "Roger · 男声", locale: "en-US" },
  { voice: "en-US-SteffanNeural", label: "Steffan · 男声", locale: "en-US" },
  { voice: "en-US-AnaNeural", label: "Ana · 女声", locale: "en-US" },
  { voice: "en-US-AshleyNeural", label: "Ashley · 女声", locale: "en-US" },
  { voice: "en-US-CoraNeural", label: "Cora · 女声", locale: "en-US" },
  { voice: "en-US-ElizabethNeural", label: "Elizabeth · 女声", locale: "en-US" },
  { voice: "en-US-JacobNeural", label: "Jacob · 男声", locale: "en-US" },
  { voice: "en-US-JaneNeural", label: "Jane · 女声", locale: "en-US" },
  { voice: "en-US-JasonNeural", label: "Jason · 男声", locale: "en-US" },
  { voice: "en-US-JennyMultilingualNeural", label: "Jenny · 多语言女声", locale: "en-US" },
  { voice: "en-US-NancyNeural", label: "Nancy · 女声", locale: "en-US" },
  { voice: "en-US-SaraNeural", label: "Sara · 女声", locale: "en-US" },
  { voice: "en-US-TonyNeural", label: "Tony · 男声", locale: "en-US" },
  { voice: "en-US-AIGenerativeNeural", label: "AI 生成音色 · 女声", locale: "en-US" },
  { voice: "en-US-JennyMultilingualV2Neural", label: "Jenny V2 · 多语言女声", locale: "en-US" },
  // ===== English (UK) =====
  { voice: "en-GB-RyanNeural", label: "Ryan · 英音男声", locale: "en-GB" },
  { voice: "en-GB-SoniaNeural", label: "Sonia · 英音女声", locale: "en-GB" },
  { voice: "en-GB-LibbyNeural", label: "Libby · 英音女声", locale: "en-GB" },
  { voice: "en-GB-GeorgeNeural", label: "George · 英音男声", locale: "en-GB" },
  { voice: "en-GB-OliverNeural", label: "Oliver · 英音男声", locale: "en-GB" },
  { voice: "en-GB-MaisieNeural", label: "Maisie · 英音女声", locale: "en-GB" },
  // ===== English (Australia/India/Others) =====
  { voice: "en-AU-NatashaNeural", label: "Natasha · 澳音女声", locale: "en-AU" },
  { voice: "en-AU-WilliamNeural", label: "William · 澳音男声", locale: "en-AU" },
  { voice: "en-IN-NeerjaNeural", label: "Neerja · 印度女声", locale: "en-IN" },
  { voice: "en-IN-PrabhatNeural", label: "Prabhat · 印度男声", locale: "en-IN" },
  { voice: "en-CA-ClaraNeural", label: "Clara · 加音女声", locale: "en-CA" },
  { voice: "en-CA-LiamNeural", label: "Liam · 加音男声", locale: "en-CA" },
  { voice: "en-IE-EmilyNeural", label: "Emily · 爱尔兰女声", locale: "en-IE" },
  { voice: "en-NZ-MollyNeural", label: "Molly · 新西兰女声", locale: "en-NZ" },
  // ===== 日本語 =====
  { voice: "ja-JP-NanamiNeural", label: "七海 · 女声", locale: "ja-JP" },
  { voice: "ja-JP-KeitaNeural", label: "圭太 · 男声", locale: "ja-JP" },
  { voice: "ja-JP-AoiNeural", label: "碧 · 女声", locale: "ja-JP" },
  { voice: "ja-JP-DaichiNeural", label: "大地 · 男声", locale: "ja-JP" },
  { voice: "ja-JP-MayuNeural", label: "繭 · 女声", locale: "ja-JP" },
  { voice: "ja-JP-NaokiNeural", label: "直紀 · 男声", locale: "ja-JP" },
  { voice: "ja-JP-ShioriNeural", label: "栞 · 女声", locale: "ja-JP" },
  // ===== 한국어 =====
  { voice: "ko-KR-SunHiNeural", label: "선히 (SunHi) · 女声", locale: "ko-KR" },
  { voice: "ko-KR-InJoonNeural", label: "인준 (InJoon) · 男声", locale: "ko-KR" },
  { voice: "ko-KR-HyunsuNeural", label: "현수 (Hyunsu) · 男声", locale: "ko-KR" },
  { voice: "ko-KR-JiMinNeural", label: "지민 (JiMin) · 女声", locale: "ko-KR" },
  { voice: "ko-KR-SeoHyeonNeural", label: "서현 (SeoHyeon) · 女声", locale: "ko-KR" },
  { voice: "ko-KR-SoonBokNeural", label: "순복 (SoonBok) · 女声", locale: "ko-KR" },
  { voice: "ko-KR-YuJinNeural", label: "유진 (YuJin) · 女声", locale: "ko-KR" },
  // ===== Français =====
  { voice: "fr-FR-DeniseNeural", label: "Denise · 女声", locale: "fr-FR" },
  { voice: "fr-FR-HenriNeural", label: "Henri · 男声", locale: "fr-FR" },
  { voice: "fr-FR-VivienneMultilingualNeural", label: "Vivienne · 多语言女声", locale: "fr-FR" },
  { voice: "fr-FR-RemyMultilingualNeural", label: "Remy · 多语言男声", locale: "fr-FR" },
  { voice: "fr-FR-CelesteNeural", label: "Céleste · 女声", locale: "fr-FR" },
  { voice: "fr-FR-EloiseNeural", label: "Éloise · 女声", locale: "fr-FR" },
  { voice: "fr-FR-JulieNeural", label: "Julie · 女声", locale: "fr-FR" },
  // ===== Deutsch =====
  { voice: "de-DE-KatjaNeural", label: "Katja · 女声", locale: "de-DE" },
  { voice: "de-DE-ConradNeural", label: "Conrad · 男声", locale: "de-DE" },
  { voice: "de-DE-AmalaNeural", label: "Amala · 女声", locale: "de-DE" },
  { voice: "de-DE-BerndNeural", label: "Bernd · 男声", locale: "de-DE" },
  { voice: "de-DE-ChristophNeural", label: "Christoph · 男声", locale: "de-DE" },
  { voice: "de-DE-FlorianMultilingualNeural", label: "Florian · 多语言男声", locale: "de-DE" },
  { voice: "de-DE-SeraphinaMultilingualNeural", label: "Seraphina · 多语言女声", locale: "de-DE" },
  // ===== Español =====
  { voice: "es-ES-ElviraNeural", label: "Elvira · 女声", locale: "es-ES" },
  { voice: "es-ES-AlvaroNeural", label: "Álvaro · 男声", locale: "es-ES" },
  { voice: "es-ES-AbrilNeural", label: "Abril · 女声", locale: "es-ES" },
  { voice: "es-ES-ArnauNeural", label: "Arnau · 男声", locale: "es-ES" },
  { voice: "es-ES-DarioNeural", label: "Darío · 男声", locale: "es-ES" },
  { voice: "es-ES-EliasNeural", label: "Elías · 男声", locale: "es-ES" },
  { voice: "es-ES-TrianaNeural", label: "Triana · 女声", locale: "es-ES" },
  { voice: "es-ES-VeraNeural", label: "Vera · 女声", locale: "es-ES" },
  { voice: "es-MX-DaliaNeural", label: "Dalia · 墨西哥女声", locale: "es-MX" },
  { voice: "es-MX-JorgeNeural", label: "Jorge · 墨西哥男声", locale: "es-MX" },
  // ===== Português =====
  { voice: "pt-BR-FranciscaNeural", label: "Francisca · 巴西女声", locale: "pt-BR" },
  { voice: "pt-BR-AntonioNeural", label: "Antônio · 巴西男声", locale: "pt-BR" },
  { voice: "pt-PT-RaquelNeural", label: "Raquel · 葡语女声", locale: "pt-PT" },
  { voice: "pt-PT-DuarteNeural", label: "Duarte · 葡语男声", locale: "pt-PT" },
  // ===== Русский =====
  { voice: "ru-RU-SvetlanaNeural", label: "Светлана · 女声", locale: "ru-RU" },
  { voice: "ru-RU-DmitryNeural", label: "Дмитрий · 男声", locale: "ru-RU" },
  { voice: "ru-RU-DariyaNeural", label: "Дарья · 女声", locale: "ru-RU" },
  // ===== Italiano =====
  { voice: "it-IT-ElsaNeural", label: "Elsa · 女声", locale: "it-IT" },
  { voice: "it-IT-DiegoNeural", label: "Diego · 男声", locale: "it-IT" },
  { voice: "it-IT-IsabellaNeural", label: "Isabella · 女声", locale: "it-IT" },
  // ===== العربية =====
  { voice: "ar-SA-ZariyahNeural", label: "زارية (Zariyah) · 女声", locale: "ar-SA" },
  { voice: "ar-SA-HamedNeural", label: "حامد (Hamed) · 男声", locale: "ar-SA" },
  { voice: "ar-EG-SalmaNeural", label: "سلمى (Salma) · 埃及女声", locale: "ar-EG" },
  { voice: "ar-EG-ShakirNeural", label: "شاكر (Shakir) · 埃及男声", locale: "ar-EG" },
  // ===== Türkçe =====
  { voice: "tr-TR-EmelNeural", label: "Emel · 女声", locale: "tr-TR" },
  { voice: "tr-TR-AhmetNeural", label: "Ahmet · 男声", locale: "tr-TR" },
  // ===== ไทย =====
  { voice: "th-TH-PremwadeeNeural", label: "เปรมวดี (Premwadee) · 女声", locale: "th-TH" },
  { voice: "th-TH-NiwatNeural", label: "นิวัฒน์ (Niwat) · 男声", locale: "th-TH" },
  // ===== Việt =====
  { voice: "vi-VN-HoaiMyNeural", label: "Hoài My · 女声", locale: "vi-VN" },
  { voice: "vi-VN-NamMinhNeural", label: "Nam Minh · 男声", locale: "vi-VN" },
  // ===== हिन्दी =====
  { voice: "hi-IN-SwaraNeural", label: "स्वरा (Swara) · 女声", locale: "hi-IN" },
  { voice: "hi-IN-MadhurNeural", label: "मधुर (Madhur) · 男声", locale: "hi-IN" },
  // ===== Bahasa =====
  { voice: "id-ID-GadisNeural", label: "Gadis · 印尼女声", locale: "id-ID" },
  { voice: "id-ID-ArdiNeural", label: "Ardi · 印尼男声", locale: "id-ID" },
  { voice: "ms-MY-YasminNeural", label: "Yasmin · 马来女声", locale: "ms-MY" },
  { voice: "ms-MY-OsmanNeural", label: "Osman · 马来男声", locale: "ms-MY" },
  // ===== Nederlands =====
  { voice: "nl-NL-ColetteNeural", label: "Colette · 女声", locale: "nl-NL" },
  { voice: "nl-NL-FennaNeural", label: "Fenna · 女声", locale: "nl-NL" },
  { voice: "nl-NL-MaartenNeural", label: "Maarten · 男声", locale: "nl-NL" },
  // ===== Polski =====
  { voice: "pl-PL-AgnieszkaNeural", label: "Agnieszka · 女声", locale: "pl-PL" },
  { voice: "pl-PL-MarekNeural", label: "Marek · 男声", locale: "pl-PL" },
  { voice: "pl-PL-ZofiaNeural", label: "Zofia · 女声", locale: "pl-PL" },
  // ===== Svenska =====
  { voice: "sv-SE-SofieNeural", label: "Sofie · 女声", locale: "sv-SE" },
  { voice: "sv-SE-MattiasNeural", label: "Mattias · 男声", locale: "sv-SE" },
  // ===== Dansk =====
  { voice: "da-DK-ChristelNeural", label: "Christel · 女声", locale: "da-DK" },
  { voice: "da-DK-JeppeNeural", label: "Jeppe · 男声", locale: "da-DK" },
  // ===== Norsk =====
  { voice: "nb-NO-PernilleNeural", label: "Pernille · 女声", locale: "nb-NO" },
  { voice: "nb-NO-FinnNeural", label: "Finn · 男声", locale: "nb-NO" },
  // ===== Suomi =====
  { voice: "fi-FI-SelmaNeural", label: "Selma · 女声", locale: "fi-FI" },
  { voice: "fi-FI-HarriNeural", label: "Harri · 男声", locale: "fi-FI" },
  // ===== Čeština =====
  { voice: "cs-CZ-VlastaNeural", label: "Vlasta · 女声", locale: "cs-CZ" },
  { voice: "cs-CZ-AntoninNeural", label: "Antonín · 男声", locale: "cs-CZ" },
  // ===== Română =====
  { voice: "ro-RO-AlinaNeural", label: "Alina · 女声", locale: "ro-RO" },
  { voice: "ro-RO-EmilNeural", label: "Emil · 男声", locale: "ro-RO" },
  // ===== Ελληνικά =====
  { voice: "el-GR-AthinaNeural", label: "Αθηνά (Athina) · 女声", locale: "el-GR" },
  { voice: "el-GR-NestorasNeural", label: "Νέστορας (Nestoras) · 男声", locale: "el-GR" },
  // ===== Magyar =====
  { voice: "hu-HU-NoemiNeural", label: "Noémi · 女声", locale: "hu-HU" },
  { voice: "hu-HU-TamasNeural", label: "Tamás · 男声", locale: "hu-HU" },
  // ===== Українська =====
  { voice: "uk-UA-PolinaNeural", label: "Поліна (Polina) · 女声", locale: "uk-UA" },
  { voice: "uk-UA-OstapNeural", label: "Остап (Ostap) · 男声", locale: "uk-UA" },
];

// 语言分组顺序 (用于下拉 optgroup 排序)
export const AZURE_TTS_VOICE_GROUPS: { locale: string; label: string }[] = [
  { locale: "zh-CN", label: "中文 (普通话)" },
  { locale: "zh-HK", label: "中文 (粤语)" },
  { locale: "zh-TW", label: "中文 (台湾)" },
  { locale: "en-US", label: "English (US)" },
  { locale: "en-GB", label: "English (UK)" },
  { locale: "en-AU", label: "English (Australia)" },
  { locale: "en-IN", label: "English (India)" },
  { locale: "en-CA", label: "English (Canada)" },
  { locale: "en-IE", label: "English (Ireland)" },
  { locale: "en-NZ", label: "English (New Zealand)" },
  { locale: "ja-JP", label: "日本語" },
  { locale: "ko-KR", label: "한국어" },
  { locale: "fr-FR", label: "Français" },
  { locale: "de-DE", label: "Deutsch" },
  { locale: "es-ES", label: "Español (España)" },
  { locale: "es-MX", label: "Español (México)" },
  { locale: "pt-BR", label: "Português (Brasil)" },
  { locale: "pt-PT", label: "Português (Portugal)" },
  { locale: "ru-RU", label: "Русский" },
  { locale: "it-IT", label: "Italiano" },
  { locale: "ar-SA", label: "العربية" },
  { locale: "ar-EG", label: "العربية (مصر)" },
  { locale: "tr-TR", label: "Türkçe" },
  { locale: "th-TH", label: "ไทย" },
  { locale: "vi-VN", label: "Tiếng Việt" },
  { locale: "hi-IN", label: "हिन्दी" },
  { locale: "id-ID", label: "Bahasa Indonesia" },
  { locale: "ms-MY", label: "Bahasa Melayu" },
  { locale: "nl-NL", label: "Nederlands" },
  { locale: "pl-PL", label: "Polski" },
  { locale: "sv-SE", label: "Svenska" },
  { locale: "da-DK", label: "Dansk" },
  { locale: "nb-NO", label: "Norsk" },
  { locale: "fi-FI", label: "Suomi" },
  { locale: "cs-CZ", label: "Čeština" },
  { locale: "ro-RO", label: "Română" },
  { locale: "el-GR", label: "Ελληνικά" },
  { locale: "hu-HU", label: "Magyar" },
  { locale: "uk-UA", label: "Українська" },
];

// 按语言分组排序后的完整列表
export const AZURE_TTS_VOICES_GROUPED = AZURE_TTS_VOICE_GROUPS.map((g) => ({
  ...g,
  voices: AZURE_TTS_VOICES.filter((v) => v.locale === g.locale || v.locale.startsWith(g.locale)),
})).filter((g) => g.voices.length > 0);
