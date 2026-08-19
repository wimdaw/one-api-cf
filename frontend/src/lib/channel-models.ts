import { Channel, ChannelConfig, ChannelModelMapping, Token, TokenConfig } from '@/types'

const normalizeModels = (models?: ChannelModelMapping[]): ChannelModelMapping[] => {
  if (!Array.isArray(models)) {
    return []
  }

  return models
    .map((model) => ({
      id: typeof model?.id === 'string' ? model.id.trim() : '',
      name: typeof model?.name === 'string' ? model.name.trim() : '',
      enabled: model?.enabled !== false,
    }))
    .filter((model) => model.id.length > 0)
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      enabled: model.enabled,
    }))
}

export const parseChannelConfig = (channel: Channel): ChannelConfig => {
  if (typeof channel.value !== 'string') {
    return channel.value
  }

  try {
    return JSON.parse(channel.value) as ChannelConfig
  } catch {
    return {} as ChannelConfig
  }
}

export const isChannelEnabled = (config: ChannelConfig): boolean => {
  return config.enabled !== false
}

export const isChannelModelEnabled = (model: ChannelModelMapping): boolean => {
  return model.enabled !== false
}

export const parseTokenConfig = (token: Token): TokenConfig => {
  if (typeof token.value !== 'string') {
    return token.value
  }

  try {
    return JSON.parse(token.value) as TokenConfig
  } catch {
    return {} as TokenConfig
  }
}

export const getChannelModels = (config: ChannelConfig): ChannelModelMapping[] => {
  const normalizedModels = normalizeModels(config.models)
  if (normalizedModels.length > 0) {
    return normalizedModels
  }

  const deploymentMapper = config.deployment_mapper || {}
  const supportedModels = Array.isArray(config.supported_models) ? config.supported_models : []
  const models: ChannelModelMapping[] = []
  const seenNames = new Set<string>()

  const pushModel = (id: string, name?: string) => {
    const normalizedId = id.trim()
    const normalizedName = (name || id).trim()

    if (!normalizedId || !normalizedName || seenNames.has(normalizedName)) {
      return
    }

    seenNames.add(normalizedName)
    models.push({
      id: normalizedId,
      name: normalizedName,
    })
  }

  supportedModels.forEach((modelName) => {
    const normalizedName = typeof modelName === 'string' ? modelName.trim() : ''
    if (!normalizedName) {
      return
    }

    pushModel(deploymentMapper[normalizedName] || normalizedName, normalizedName)
  })

  Object.entries(deploymentMapper).forEach(([modelName, modelId]) => {
    if (typeof modelId !== 'string') {
      return
    }

    pushModel(modelId, modelName)
  })

  return models
}

export const getUniqueModelNamesFromChannels = (channels: Channel[]): string[] => {
  const modelNames = new Set<string>()

  channels.forEach((channel) => {
    const config = parseChannelConfig(channel)
    if (!isChannelEnabled(config)) {
      return
    }
    getChannelModels(config)
      .filter((model) => isChannelModelEnabled(model))
      .forEach((model) => modelNames.add(model.name))
  })

  return Array.from(modelNames).sort()
}

export const getChannelsForToken = (tokenKey: string, tokens: Token[], channels: Channel[]): Channel[] => {
  const matchedToken = tokens.find((token) => token.key === tokenKey)

  if (!matchedToken) {
    return []
  }

  const tokenConfig = parseTokenConfig(matchedToken)
  const allowedChannelKeys = tokenConfig.channel_keys || []

  // 空数组 = 未绑定任何渠道 (0渠道, 无调用权限); 有 key 则按 key 过滤
  return allowedChannelKeys.length === 0
    ? []
    : channels.filter((channel) => allowedChannelKeys.includes(channel.key))
}

export const channelSupportsModel = (channel: Channel, modelName: string): boolean => {
  if (!modelName) {
    return true
  }

  const config = parseChannelConfig(channel)
  return getChannelModels(config)
    .filter((model) => isChannelModelEnabled(model))
    .some((model) => model.name === modelName)
}

export const getModelNamesForChannels = (channels: Channel[]): string[] => getUniqueModelNamesFromChannels(channels)

export const getModelNamesForToken = (tokenKey: string, tokens: Token[], channels: Channel[]): string[] => {
  const targetChannels = getChannelsForToken(tokenKey, tokens, channels)
  return getUniqueModelNamesFromChannels(targetChannels)
}

// ---------------------------------------------------------------------------
// 模型 → 端点自动匹配 (操练场: 选择模型后自动切换对应端点)
// 优先级: 渠道类型 > 模型名模式 > 默认 chat/completions
// ---------------------------------------------------------------------------

export type TestEndpoint =
  | '/v1/chat/completions'
  | '/v1/messages'
  | '/v1/responses'
  | '/v1/audio/speech'
  | '/v1/audio/transcriptions'
  | '/v1/audio/translations'
  | '/v1/images/generations'
  | '/v1/images/edits'
  | '/v1/videos/generations'
  | '/v1/video/generations'
  | '/v1/embeddings'

// 渠道类型 → 默认端点
const channelTypeToEndpoint: Record<string, TestEndpoint> = {
  'claude': '/v1/messages',
  'azure-tts': '/v1/audio/speech',
  'openai-audio': '/v1/audio/speech',
  'azure-openai-audio': '/v1/audio/speech',
  'openai-video': '/v1/videos/generations',
  'agnes-video': '/v1/videos/generations',
}

// 模型名模式 → 端点 (渠道类型未知时的兜底)
const modelPatternToEndpoint: Array<{ pattern: RegExp; endpoint: TestEndpoint }> = [
  // 图片生成 (优先于 video, 因为部分模型含 image 字样)
  { pattern: /(dall-e|dalle|stable-diffusion|sdxl|flux|midjourney|image|imagen|gemini.*image)/i, endpoint: '/v1/images/generations' },
  // 图片编辑
  { pattern: /(image.*edit|edit.*image)/i, endpoint: '/v1/images/edits' },
  // 语音合成
  { pattern: /(tts|text-to-speech|speech|voice|audio.*speech|elevenlabs)/i, endpoint: '/v1/audio/speech' },
  // 语音转写/翻译
  { pattern: /(whisper|transcription|stt|speech-to-text|audio.*transcri)/i, endpoint: '/v1/audio/transcriptions' },
  // 视频生成
  { pattern: /(video|veo|kling|runway|sora|pika|agnes|hailuo|vidu)/i, endpoint: '/v1/videos/generations' },
  // 向量嵌入
  { pattern: /(embedding|text-embedding|bge-)/i, endpoint: '/v1/embeddings' },
  // Claude 系列
  { pattern: /(claude|sonnet|opus|haiku)/i, endpoint: '/v1/messages' },
]

// 根据渠道类型 + 模型名推断端点; 返回 null 表示无法推断(调用方保持当前端点)
export const inferEndpointForModel = (modelName: string, channel?: Channel): TestEndpoint | null => {
  if (!modelName) {
    return null
  }

  const name = modelName.trim()

  // 1. 渠道类型优先
  if (channel) {
    const config = parseChannelConfig(channel)
    const channelEndpoint = channelTypeToEndpoint[config.type]
    if (channelEndpoint) {
      // 音频渠道: whisper 类模型走转写, 其余走语音合成
      if ((config.type === 'openai-audio' || config.type === 'azure-openai-audio' || config.type === 'azure-tts')
        && /(whisper|transcri|stt)/i.test(name)) {
        return '/v1/audio/transcriptions'
      }
      return channelEndpoint
    }
    // openai-responses 系列渠道: 保持 chat/completions (responses 端点在操练场体验不完整)
  }

  // 2. 模型名模式兜底
  for (const { pattern, endpoint } of modelPatternToEndpoint) {
    if (pattern.test(name)) {
      return endpoint
    }
  }

  // 3. 默认聊天补全
  return '/v1/chat/completions'
}
