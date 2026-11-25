import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { extractCodexRefIds, stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformDefaultAI } from '@/lib/platform-ai'

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const novelId = new URL(req.url).searchParams.get('novelId')
  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })

  const issues = await (db as any).consistencyIssue.findMany({
    where: { novelId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json({ issues })
}

/**
 * POST /api/guard - 运行一致性守卫巡检（确定性规则 + 可选 AI 逻辑冲突扫描）
 */
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const body = await req.json()
  const { novelId, chapterId, withAi = false } = body
  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })

  const [novel, chapters, characters, worldviews, items, timelineEvents] =
    await Promise.all([
      db.novel.findUnique({ where: { id: novelId } }),
      db.chapter.findMany({ where: { novelId }, orderBy: { sortOrder: 'asc' } }),
      db.character.findMany({ where: { novelId } }),
      db.worldview.findMany({ where: { novelId } }),
      db.item.findMany({ where: { novelId } }),
      (db as any).timelineEvent.findMany({
        where: { novelId },
        orderBy: { sortOrder: 'asc' },
      }),
    ])

  if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 })

  const validCodexIds = new Set([
    ...characters.map((c) => c.id),
    ...worldviews.map((w) => w.id),
    ...items.map((i) => i.id),
  ])

  const foundIssues: Array<{
    novelId: string
    chapterId: string | null
    category: string
    severity: string
    title: string
    detail: string
    suggestion?: string
  }> = []

  // 1. 确定性规则：检查 @CodexRef 失效引用 & 章节摘要缺失
  for (const ch of chapters) {
    const refIds = extractCodexRefIds(ch.content || '')
    const missing = refIds.filter((id) => !validCodexIds.has(id))
    if (missing.length > 0) {
      foundIssues.push({
        novelId,
        chapterId: ch.id,
        category: 'codex',
        severity: 'error',
        title: `「${ch.title}」存在 ${missing.length} 处失效的 @ 设定引用`,
        detail: `引用的设定 ID（${missing.slice(0, 3).join(', ')}）在设定库中已不存在，可能导致上下文装配缺失。`,
        suggestion: '回到该章节重新 @ 选择设定条目，或恢复对应设定。',
      })
    }
    const plain = stripHtml(ch.content || '')
    if (plain.length > 500 && !ch.summary?.trim()) {
      foundIssues.push({
        novelId,
        chapterId: ch.id,
        category: 'timeline',
        severity: 'info',
        title: `「${ch.title}」尚未填写章节摘要`,
        detail: '超过 500 字的章节建议补充核心事件摘要，否则后续章节 AI 续写时无法感知前情要点。',
        suggestion: '在章节工具或一键生成面板补充核心事件摘要。',
      })
    }
  }

  // 2. 确定性规则：重复角色名检查
  const nameCount = new Map<string, number>()
  for (const c of characters) {
    const n = c.name.trim()
    nameCount.set(n, (nameCount.get(n) || 0) + 1)
  }
  for (const [name, count] of nameCount.entries()) {
    if (count > 1) {
      foundIssues.push({
        novelId,
        chapterId: null,
        category: 'character',
        severity: 'warning',
        title: `设定库存在同名角色「${name}」（${count} 条）`,
        detail: '同名角色容易导致 AI 在上下文装配和人物对话中混淆性格与背景。',
        suggestion: '合并重复条目或在名称中加上区分标识。',
      })
    }
  }

  // 3. 可选 AI 深度一致性检查（针对当前章或最近几章）
  if (withAi) {
    const targetChapter = chapterId
      ? chapters.find((c) => c.id === chapterId)
      : chapters[chapters.length - 1]
    if (targetChapter) {
      const plain = stripHtml(targetChapter.content || '').slice(0, 4000)
      if (plain.length > 100) {
        const aiConfig =
          (await db.userAiConfig.findFirst({
            where: { userId: user.id, enabled: true, isDefault: true },
          })) || (await getPlatformDefaultAI())

        if (aiConfig) {
          const prompt = `请作为长篇网文一致性守卫，检查以下章节正文是否与设定库、时间线存在矛盾（如人物性格/能力冲突、时间倒流、死人复生、道具属性不符）。
【角色设定】
${characters.map((c) => `- ${c.name}: 性格=${c.personality || ''} 能力=${c.abilities || ''}`).join('\n')}
【时间线】
${timelineEvents.map((t: any) => `- [${t.timeLabel}] ${t.title}`).join('\n')}
【待检查章节：${targetChapter.title}】
${plain}

请严格返回 JSON 数组，格式为：[{"category":"character|timeline|logic","severity":"warning|error","title":"简短问题标题","detail":"具体矛盾点","suggestion":"修改建议"}]。若无明显矛盾返回 []。`

          const res = await callThirdPartyAI(
            aiConfig,
            [
              { role: 'system', content: '你是严谨的小说逻辑与设定一致性审查员，只输出合法 JSON 数组。' },
              { role: 'user', content: prompt },
            ],
            { stream: false }
          )
          if (res.ok && res.reply) {
            try {
              const jsonMatch = res.reply.match(/\[[\s\S]*\]/)
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                if (Array.isArray(parsed)) {
                  for (const item of parsed.slice(0, 8)) {
                    if (item?.title && item?.detail) {
                      foundIssues.push({
                        novelId,
                        chapterId: targetChapter.id,
                        category: item.category || 'logic',
                        severity: item.severity === 'error' ? 'error' : 'warning',
                        title: String(item.title),
                        detail: String(item.detail),
                        suggestion: item.suggestion ? String(item.suggestion) : undefined,
                      })
                    }
                  }
                }
              }
            } catch {}
          }
        }
      }
    }
  }

  // 清理旧的 open 问题并写入新扫描结果
  await (db as any).consistencyIssue.deleteMany({
    where: { novelId, status: 'open' },
  })
  if (foundIssues.length > 0) {
    await (db as any).consistencyIssue.createMany({ data: foundIssues })
  }

  const issues = await (db as any).consistencyIssue.findMany({
    where: { novelId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json({ issues, scannedCount: foundIssues.length })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { id, status } = body
  if (!id || !['open', 'resolved', 'ignored'].includes(status)) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 })
  }

  const issue = await (db as any).consistencyIssue.update({
    where: { id },
    data: { status },
  })
  return NextResponse.json({ issue })
}
