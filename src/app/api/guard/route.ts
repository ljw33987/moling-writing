import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformDefaultAI } from '@/lib/platform-ai'
import { collectGuardIssues, type GuardIssueDraft } from '@/lib/guard'

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

  const [novel, chapters, characters, timelineEvents] =
    await Promise.all([
      db.novel.findUnique({ where: { id: novelId } }),
      db.chapter.findMany({ where: { novelId }, orderBy: { sortOrder: 'asc' } }),
      db.character.findMany({ where: { novelId } }),
      (db as any).timelineEvent.findMany({
        where: { novelId },
        orderBy: { sortOrder: 'asc' },
      }),
    ])

  if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 })

  // 确定性规则（共用 src/lib/guard.ts）：失效 @ 引用 / 摘要缺失 / 同名角色
  const foundIssues: GuardIssueDraft[] = await collectGuardIssues(novelId)
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
          const prompt = `请作为长篇网文一致性守卫，检查以下章节正文是否与设定库、时间线存在矛盾（如人物性格/能力冲突、时间倒流、死人复生、道具属性不符），并重点核对本章内部的「数值账目」与「人物站位」：
- 倒计时/计时数字前后是否一致（如批注说六十秒后执行、广播却报三十秒）；
- 账目类数字是否凭空出现（积分、金钱、数量——惩罚/奖励必须先有规则依据再落地）；
- 人物站位与门窗/电梯/门锁状态是否冲突（如站在电梯里却撞上关着的电梯门、公示未结束规则却提前生效）。
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
