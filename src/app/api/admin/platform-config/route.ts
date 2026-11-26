import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminOr401 } from '@/lib/auth'
import { parseModelMappings, type AdminModelMapping } from '@/lib/ai-models'

function maskMappingKeys(mappings: AdminModelMapping[]): AdminModelMapping[] {
  return mappings.map((m) => ({
    ...m,
    apiKey: m.apiKey ? `****${m.apiKey.slice(-4)}` : '',
  }))
}

// GET - 获取平台配置（管理员）
export async function GET() {
  const session = await requireAdminOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  let config = await db.platformConfig.findUnique({ where: { id: 'default' } })
  if (!config) {
    config = await db.platformConfig.create({ data: { id: 'default' } })
  }

  const mappings = parseModelMappings((config as any).modelMappings)

  // 隐藏 API Key 明文
  const safe = {
    ...config,
    defaultAiApiKey: config.defaultAiApiKey ? `****${config.defaultAiApiKey.slice(-4)}` : '',
    hasApiKey: !!config.defaultAiApiKey,
    customPackages: config.customPackages ? JSON.parse(config.customPackages) : [],
    modelMappings: maskMappingKeys(mappings),
  }

  return NextResponse.json({ config: safe })
}

// POST - 更新平台配置
export async function POST(req: NextRequest) {
  const session = await requireAdminOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const {
    platformName, platformIcon, platformDesc,
    mode, rechargeEnabled, customPackages,
    defaultAiProvider, defaultAiApiKey, defaultAiBaseUrl, defaultAiModel,
    modelMappings,
    registerTokens,
  } = body

  // 获取现有配置
  let config = await db.platformConfig.findUnique({ where: { id: 'default' } })
  if (!config) {
    config = await db.platformConfig.create({ data: { id: 'default' } })
  }

  const data: any = {}
  if (platformName !== undefined) data.platformName = platformName
  if (platformIcon !== undefined) data.platformIcon = platformIcon
  if (platformDesc !== undefined) data.platformDesc = platformDesc
  if (mode !== undefined) data.mode = mode
  if (rechargeEnabled !== undefined) data.rechargeEnabled = rechargeEnabled
  if (customPackages !== undefined) data.customPackages = JSON.stringify(customPackages)
  if (defaultAiProvider !== undefined) data.defaultAiProvider = defaultAiProvider
  if (defaultAiBaseUrl !== undefined) data.defaultAiBaseUrl = defaultAiBaseUrl
  if (defaultAiModel !== undefined) data.defaultAiModel = defaultAiModel
  if (registerTokens !== undefined) data.registerTokens = Number(registerTokens)

  // API Key：空或 **** 开头时保留原值
  if (defaultAiApiKey && !defaultAiApiKey.startsWith('****')) {
    data.defaultAiApiKey = defaultAiApiKey
  }

  // 对外模型映射：保留未修改的 ****xxxx apiKey
  if (Array.isArray(modelMappings)) {
    const existingMappings = parseModelMappings((config as any).modelMappings)
    const existingByAlias = new Map(existingMappings.map((m) => [m.aliasId, m]))
    const sanitized: AdminModelMapping[] = modelMappings
      .filter((m: any) => m && typeof m.aliasId === 'string' && m.aliasId.trim())
      .map((m: any) => {
        const aliasId = m.aliasId.trim()
        const prev = existingByAlias.get(aliasId)
        let resolvedKey = typeof m.apiKey === 'string' ? m.apiKey.trim() : ''
        if (resolvedKey.startsWith('****')) {
          resolvedKey = prev?.apiKey || ''
        }
        return {
          aliasId,
          displayName: (m.displayName || aliasId).trim(),
          badge: (m.badge || '标准').trim(),
          description: (m.description || '').trim(),
          provider: (m.provider || '').trim(),
          baseUrl: (m.baseUrl || '').trim(),
          apiKey: resolvedKey,
          realModel: (m.realModel || '').trim(),
          enabled: m.enabled !== false,
          isPro: !!m.isPro,
          isDefault: !!m.isDefault,
        }
      })
    data.modelMappings = JSON.stringify(sanitized)
  }

  const updated = await db.platformConfig.update({ where: { id: 'default' }, data })
  const updatedMappings = parseModelMappings((updated as any).modelMappings)

  return NextResponse.json({
    config: {
      ...updated,
      defaultAiApiKey: updated.defaultAiApiKey ? `****${updated.defaultAiApiKey.slice(-4)}` : '',
      hasApiKey: !!updated.defaultAiApiKey,
      customPackages: updated.customPackages ? JSON.parse(updated.customPackages) : [],
      modelMappings: maskMappingKeys(updatedMappings),
    },
    message: '配置已保存',
  })
}
