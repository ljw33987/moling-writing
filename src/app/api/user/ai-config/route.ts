import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { AI_PROVIDERS } from '@/lib/ai-providers'
import { syncDefaultAiToPlatformConfig } from '@/lib/platform-ai'

// GET /api/user/ai-config - 获取平台 AI 接口池 + 提供商预设（仅管理员）
export async function GET() {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可管理 AI 接口配置' }, { status: 403 })
  }

  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT id, userId, provider, name, apiKey, baseUrl, model, enabled, isDefault, priority, lastTestAt, lastTestOk, lastTestErr, createdAt, updatedAt
     FROM UserAiConfig
     WHERE userId = ?
     ORDER BY isDefault DESC, priority ASC, createdAt ASC`,
    session.user.id
  )

  const safeConfigs = rows.map((c) => ({
    ...c,
    enabled: Boolean(c.enabled),
    isDefault: Boolean(c.isDefault),
    priority: Number(c.priority ?? 100),
    lastTestOk: Boolean(c.lastTestOk),
    apiKey: c.apiKey ? `****${String(c.apiKey).slice(-4)}` : '',
    hasApiKey: !!c.apiKey,
  }))

  return NextResponse.json({
    configs: safeConfigs,
    providers: AI_PROVIDERS,
  })
}

// POST - 创建接口配置并同步默认接口到平台（仅管理员）
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可管理 AI 接口配置' }, { status: 403 })
  }

  const body = await req.json()
  const { provider, name, apiKey, baseUrl, model, isDefault } = body

  if (!provider || !apiKey?.trim()) {
    return NextResponse.json({ error: '请选择提供商并填写 API Key' }, { status: 400 })
  }

  const preset = AI_PROVIDERS[provider]
  if (!preset) {
    return NextResponse.json({ error: '未知的提供商' }, { status: 400 })
  }

  const finalBaseUrl = baseUrl?.trim() || preset.baseUrl
  const finalModel = model?.trim() || preset.defaultModel
  const finalName = name?.trim() || preset.name

  if (!finalBaseUrl || !finalModel) {
    return NextResponse.json({ error: '请填写完整的 Base URL 和模型名' }, { status: 400 })
  }

  const count = await db.userAiConfig.count({ where: { userId: session.user.id } })
  const shouldBeDefault = Boolean(isDefault) || count === 0

  if (shouldBeDefault) {
    await db.userAiConfig.updateMany({
      where: { userId: session.user.id, isDefault: true },
      data: { isDefault: false },
    })
  }

  const config = await db.userAiConfig.create({
    data: {
      userId: session.user.id,
      provider,
      name: finalName,
      apiKey: apiKey.trim(),
      baseUrl: finalBaseUrl,
      model: finalModel,
      isDefault: shouldBeDefault,
    },
  })

  const nextPriority = shouldBeDefault ? 1 : count + 1
  await db.$executeRawUnsafe(
    `UPDATE UserAiConfig SET priority = ? WHERE id = ?`,
    nextPriority,
    config.id
  )

  await syncDefaultAiToPlatformConfig()

  return NextResponse.json({
    config: {
      ...config,
      priority: nextPriority,
      apiKey: `****${config.apiKey.slice(-4)}`,
      hasApiKey: true,
    },
  })
}

// PATCH - 更新配置或调整优先级顺序（仅管理员）
export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可管理 AI 接口配置' }, { status: 403 })
  }

  const body = await req.json()

  // 批量重排备选优先级（orderedIds[0] 为主接口，其余按顺序作为备选）
  if (body?.action === 'reorder' && Array.isArray(body.orderedIds)) {
    const ids: string[] = body.orderedIds.filter((x: any) => typeof x === 'string' && x)
    for (let i = 0; i < ids.length; i++) {
      await db.$executeRawUnsafe(
        `UPDATE UserAiConfig SET priority = ?, isDefault = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
        i + 1,
        i === 0 ? 1 : 0,
        new Date().toISOString(),
        ids[i],
        session.user.id
      )
    }
    await syncDefaultAiToPlatformConfig()
    return NextResponse.json({ ok: true })
  }

  const { id, name, apiKey, baseUrl, model, enabled, isDefault, priority } = body
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  const existing = await db.userAiConfig.findUnique({ where: { id } })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: '未找到配置' }, { status: 404 })
  }

  const data: any = {}
  if (name !== undefined) data.name = name
  if (apiKey && !apiKey.startsWith('****')) {
    data.apiKey = apiKey
  }
  if (baseUrl !== undefined) data.baseUrl = baseUrl
  if (model !== undefined) data.model = model
  if (enabled !== undefined) data.enabled = enabled
  if (isDefault !== undefined) {
    if (isDefault) {
      await db.userAiConfig.updateMany({
        where: { userId: session.user.id, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }
    data.isDefault = isDefault
  }

  const config = await db.userAiConfig.update({ where: { id }, data })

  if (priority !== undefined) {
    await db.$executeRawUnsafe(
      `UPDATE UserAiConfig SET priority = ? WHERE id = ?`,
      Number(priority),
      id
    )
  } else if (isDefault === true) {
    // 设为默认时自动置于最高优先级 #1
    await db.$executeRawUnsafe(`UPDATE UserAiConfig SET priority = 1 WHERE id = ?`, id)
  }

  await syncDefaultAiToPlatformConfig()

  return NextResponse.json({
    config: { ...config, apiKey: `****${config.apiKey.slice(-4)}`, hasApiKey: true },
  })
}

// DELETE - 删除配置并重新同步平台默认 AI（仅管理员）
export async function DELETE(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可管理 AI 接口配置' }, { status: 403 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  const existing = await db.userAiConfig.findUnique({ where: { id } })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: '未找到配置' }, { status: 404 })
  }

  await db.userAiConfig.delete({ where: { id } })
  await syncDefaultAiToPlatformConfig()
  return NextResponse.json({ ok: true, message: '已删除' })
}
