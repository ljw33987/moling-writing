export interface PublicAiModel {
  id: string
  name: string
  label: string
  badge: string
  description: string
  isPro?: boolean
  isDefault?: boolean
}

export interface AdminModelMapping {
  aliasId: string       // 对外暴露的模型名（如 baogeng_v4、baogeng_v4_pro）
  displayName: string   // 前端显示名称
  badge: string         // 标签（如 标准 / 增强）
  description: string   // 描述
  provider: string      // 后台实际提供商（如 deepseek / minimax，不对外暴露）
  configId?: string     // 绑定的平台接口池 ID（可选）
  baseUrl: string       // 后台实际 Base URL（留空则使用平台默认）
  apiKey: string        // 后台实际 API Key（留空则使用平台默认）
  realModel: string     // 后台实际模型名（如 deepseek-chat / MiniMax-M2.7，不对外暴露）
  enabled: boolean
  isPro?: boolean
  isDefault?: boolean
}

export const DEFAULT_MODEL_MAPPINGS: AdminModelMapping[] = [
  {
    aliasId: 'baogeng_v4',
    displayName: 'baogeng_v4',
    badge: '标准',
    description: '响应迅速，适合日常创作对话、续写与润色',
    provider: '',
    baseUrl: '',
    apiKey: '',
    realModel: '',
    enabled: true,
    isDefault: true,
  },
  {
    aliasId: 'baogeng_v4_pro',
    displayName: 'baogeng_v4_pro',
    badge: '增强',
    description: '深度推理与长篇精修，适合多文件分析、拆书与复杂大纲推演',
    provider: '',
    baseUrl: '',
    apiKey: '',
    realModel: '',
    enabled: true,
    isPro: true,
  },
]

export const PLATFORM_MODEL_ALIASES: PublicAiModel[] = DEFAULT_MODEL_MAPPINGS.map((m) => ({
  id: m.aliasId,
  name: m.aliasId,
  label: m.displayName,
  badge: m.badge,
  description: m.description,
  isPro: m.isPro,
  isDefault: m.isDefault,
}))

export function parseModelMappings(raw: string | null | undefined): AdminModelMapping[] {
  if (!raw || !raw.trim()) return DEFAULT_MODEL_MAPPINGS
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
    }
  } catch { }
  return DEFAULT_MODEL_MAPPINGS
}

export function toPublicModels(mappings: AdminModelMapping[]): PublicAiModel[] {
  return mappings
    .filter((m) => m.enabled !== false && m.aliasId?.trim())
    .map((m) => ({
      id: m.aliasId.trim(),
      name: m.aliasId.trim(),
      label: (m.displayName || m.aliasId).trim(),
      badge: m.badge || '标准',
      description: m.description || '',
      isPro: !!m.isPro,
      isDefault: !!m.isDefault,
    }))
}

export function getPlatformProAiFromEnv(): {
  baseUrl: string
  apiKey: string
  model: string
} | null {
  const baseUrl = process.env.PLATFORM_PRO_AI_BASE_URL?.trim()
  const apiKey = process.env.PLATFORM_PRO_AI_API_KEY?.trim()
  const model = process.env.PLATFORM_PRO_AI_MODEL?.trim()
  if (!baseUrl || !apiKey || !model) return null
  return { baseUrl, apiKey, model }
}
