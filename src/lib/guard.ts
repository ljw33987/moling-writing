import { db } from '@/lib/db'
import { extractCodexRefIds, stripHtml } from '@/lib/context-assembler'

/**
 * 确定性一致性守卫规则（可复用模块）
 * 供 /api/guard 路由（全书巡检）与 auto-serial-runner（单章落库后校验）共用。
 * AI 深度扫描仍保留在路由层，本模块只做零 Token 成本的确定性检查。
 */

export type GuardCategory = 'codex' | 'timeline' | 'character' | 'logic'
export type GuardSeverity = 'info' | 'warning' | 'error'

export interface GuardIssueDraft {
  novelId: string
  chapterId: string | null
  category: GuardCategory
  severity: GuardSeverity
  title: string
  detail: string
  suggestion?: string
}

export interface GuardCheckOptions {
  /** 只检查指定章节（如自动连载新生成章），不传则检查全书 */
  chapterIds?: string[]
  /** novel=全书巡检（含同名角色全局规则）；chapter=单章校验 */
  scope?: 'novel' | 'chapter'
}

/**
 * 收集确定性守卫问题（不写库，纯计算，方便单测与调用方自行决定落库策略）。
 */
export async function collectGuardIssues(
  novelId: string,
  options: GuardCheckOptions = {}
): Promise<GuardIssueDraft[]> {
  const scope = options.scope ?? 'novel'
  const chapterWhere: { novelId: string; id?: { in: string[] } } = { novelId }
  if (options.chapterIds?.length) chapterWhere.id = { in: options.chapterIds }

  const [chapters, characters, worldviews, items] = await Promise.all([
    db.chapter.findMany({
      where: chapterWhere,
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, content: true, summary: true },
    }),
    db.character.findMany({ where: { novelId }, select: { id: true, name: true } }),
    db.worldview.findMany({ where: { novelId }, select: { id: true } }),
    db.item.findMany({ where: { novelId }, select: { id: true } }),
  ])

  const validCodexIds = new Set<string>([
    ...characters.map((c) => c.id),
    ...worldviews.map((w) => w.id),
    ...items.map((i) => i.id),
  ])

  const issues: GuardIssueDraft[] = []

  // 规则 1：@CodexRef 失效引用
  for (const ch of chapters) {
    const refIds = extractCodexRefIds(ch.content || '')
    const missing = refIds.filter((id) => !validCodexIds.has(id))
    if (missing.length > 0) {
      issues.push({
        novelId,
        chapterId: ch.id,
        category: 'codex',
        severity: 'error',
        title: `「${ch.title}」存在 ${missing.length} 处失效的 @ 设定引用`,
        detail: `引用的设定 ID（${missing.slice(0, 3).join(', ')}）在设定库中已不存在，可能导致上下文装配缺失。`,
        suggestion: '回到该章节重新 @ 选择设定条目，或恢复对应设定。',
      })
    }

    // 规则 2：章节摘要缺失
    const plain = stripHtml(ch.content || '')
    if (plain.length > 500 && !ch.summary?.trim()) {
      issues.push({
        novelId,
        chapterId: ch.id,
        category: 'timeline',
        severity: 'info',
        title: `「${ch.title}」尚未填写章节摘要`,
        detail:
          '超过 500 字的章节建议补充核心事件摘要，否则后续章节 AI 续写时无法感知前情要点。',
        suggestion: '在章节工具或一键生成面板补充核心事件摘要。',
      })
    }
  }

  // 规则 3：设定库同名角色（仅全书巡检）
  if (scope === 'novel') {
    const nameCount = new Map<string, number>()
    for (const c of characters) {
      const n = c.name.trim()
      if (!n) continue
      nameCount.set(n, (nameCount.get(n) || 0) + 1)
    }
    for (const [name, count] of nameCount.entries()) {
      if (count > 1) {
        issues.push({
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
  }

  return issues
}

/**
 * 追加写入守卫告警（不清理历史记录，用于自动连载等"只记录不重试"场景）。
 */
export async function recordGuardIssues(issues: GuardIssueDraft[]): Promise<void> {
  if (issues.length === 0) return
  await db.consistencyIssue.createMany({ data: issues })
}

/**
 * 单章守卫：收集问题并落库（尽力而为，失败仅打日志，不抛出）。
 * 供 auto-serial-runner 在章节落库后调用。
 */
export async function runChapterGuardSafely(
  novelId: string,
  chapterId: string,
  chapterTitle?: string
): Promise<number> {
  try {
    const issues = await collectGuardIssues(novelId, {
      chapterIds: [chapterId],
      scope: 'chapter',
    })
    await recordGuardIssues(issues)
    if (issues.length > 0) {
      console.log(
        `[guard] 章节「${chapterTitle || chapterId}」守卫告警 ${issues.length} 条（已记录，不重试）`
      )
    }
    return issues.length
  } catch (err) {
    console.error('[guard] 守卫校验失败（忽略，不阻塞主流程）:', err)
    return 0
  }
}
