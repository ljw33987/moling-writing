import { db } from './db'
import { callThirdPartyAI } from './ai-providers'

export interface AiEndpointConfig {
  id?: string
  name?: string
  provider?: string
  baseUrl: string
  apiKey: string
  model: string
}

// 获取平台配置
export async function getPlatformConfig() {
  let config = await db.platformConfig.findUnique({ where: { id: 'default' } })
  if (!config) {
    config = await db.platformConfig.create({ data: { id: 'default' } })
  }
  return config
}

// 获取管理员在「AI 接口池」中配置的已启用接口（按 默认优先 + 优先级数字升序）
export async function getAdminAiPoolConfigs(includeDisabled = false): Promise<
  Array<AiEndpointConfig & { id: string; enabled: boolean; isDefault: boolean; priority: number }>
> {
  const whereClause = includeDisabled
    ? `u.role = 'admin'`
    : `u.role = 'admin' AND c.enabled = 1`
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT c.id, c.name, c.provider, c.baseUrl, c.apiKey, c.model, c.enabled, c.isDefault, c.priority
     FROM UserAiConfig c
     INNER JOIN User u ON u.id = c.userId
     WHERE ${whereClause}
     ORDER BY c.isDefault DESC, c.priority ASC, c.createdAt ASC`
  )
  return rows
    .filter((r) => r.baseUrl?.trim() && r.apiKey?.trim() && r.model?.trim())
    .map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      baseUrl: String(r.baseUrl).trim(),
      apiKey: String(r.apiKey).trim(),
      model: String(r.model).trim(),
      enabled: Boolean(r.enabled),
      isDefault: Boolean(r.isDefault),
      priority: Number(r.priority ?? 100),
    }))
}

// 将接口池中的主接口（#1 默认或最高优先级）自动同步到 PlatformConfig
export async function syncDefaultAiToPlatformConfig(): Promise<void> {
  const pool = await getAdminAiPoolConfigs(false)
  const primary = pool[0]
  if (!primary) return
  await getPlatformConfig()
  await db.platformConfig.update({
    where: { id: 'default' },
    data: {
      defaultAiProvider: primary.provider || 'custom',
      defaultAiBaseUrl: primary.baseUrl,
      defaultAiApiKey: primary.apiKey,
      defaultAiModel: primary.model,
    },
  })
}

// 获取平台默认 AI 配置（优先 PlatformConfig，为空时自动兜底管理员接口池 #1）
export async function getPlatformDefaultAI(): Promise<{
  baseUrl: string
  apiKey: string
  model: string
} | null> {
  const config = await getPlatformConfig()
  if (config.defaultAiApiKey && config.defaultAiBaseUrl && config.defaultAiModel) {
    return {
      baseUrl: config.defaultAiBaseUrl,
      apiKey: config.defaultAiApiKey,
      model: config.defaultAiModel,
    }
  }
  const pool = await getAdminAiPoolConfigs(false)
  if (pool.length > 0) {
    return {
      baseUrl: pool[0].baseUrl,
      apiKey: pool[0].apiKey,
      model: pool[0].model,
    }
  }
  return null
}

// 组装按优先级排序的候选 AI 接口列表（首选接口 -> 平台默认 -> 接口池其余备选接口）
export async function getPlatformAiCandidates(
  preferred?: AiEndpointConfig | null
): Promise<AiEndpointConfig[]> {
  const candidates: AiEndpointConfig[] = []
  const seen = new Set<string>()

  const pushUnique = (c: AiEndpointConfig | null | undefined) => {
    if (!c || !c.baseUrl?.trim() || !c.apiKey?.trim() || !c.model?.trim()) return
    const key = `${c.baseUrl.trim()}|${c.model.trim()}|${c.apiKey.trim()}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({
      ...c,
      baseUrl: c.baseUrl.trim(),
      apiKey: c.apiKey.trim(),
      model: c.model.trim(),
    })
  }

  pushUnique(preferred)
  const defaultAi = await getPlatformDefaultAI()
  pushUnique(defaultAi)

  const pool = await getAdminAiPoolConfigs(false)
  for (const item of pool) {
    pushUnique(item)
  }

  return candidates
}

// 按优先级依次尝试候选接口，遇到 429/5xx/连接异常自动降级到下一顺位备选接口
export async function callThirdPartyAIWithFallback(
  candidates: AiEndpointConfig[],
  messages: { role: string; content: string }[],
  options?: { stream?: boolean; temperature?: number }
): Promise<{
  ok: boolean
  reply?: string
  error?: string
  stream?: ReadableStream<Uint8Array>
  usedConfig?: AiEndpointConfig
}> {
  if (!candidates || candidates.length === 0) {
    return { ok: false, error: '未配置可用的平台 AI 接口' }
  }

  let lastError = 'AI 调用失败'
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]
    const res = await callThirdPartyAI(cand, messages, options)
    if (res.ok) {
      return { ...res, usedConfig: cand }
    }
    lastError = res.error || lastError
    console.warn(
      `[AI Fallback] 接口 #${i + 1} (${cand.name || cand.model}) 调用失败: ${lastError}`
    )
  }

  return { ok: false, error: lastError }
}

// 调用平台默认 AI（非流式，带备选自动降级）
export async function callPlatformAI(
  messages: { role: string; content: string }[]
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const candidates = await getPlatformAiCandidates()
  if (candidates.length === 0) return { ok: false, error: '平台未配置默认 AI' }
  return callThirdPartyAIWithFallback(candidates, messages)
}

// 调用平台默认 AI（流式，带备选自动降级）
export async function callPlatformAIStream(
  messages: { role: string; content: string }[]
): Promise<{ ok: boolean; stream?: ReadableStream<Uint8Array>; reply?: string; error?: string }> {
  const candidates = await getPlatformAiCandidates()
  if (candidates.length === 0) return { ok: false, error: '平台未配置默认 AI' }
  return callThirdPartyAIWithFallback(candidates, messages, { stream: true })
}
