import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { getOwnedChapter } from '@/lib/ownership'
import { stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformDefaultAI } from '@/lib/platform-ai'

/**
 * POST /api/guard/fix-summary - 一键修复「缺失章节摘要」
 *
 * 为什么不走 /api/ai：/api/ai 有用户级并发槽限制（同时 3 个任务），工作台一键修复
 * 常与其他 AI 操作撞车报「多个 AI 任务正在生成中」。摘要生成走守卫同款的平台 AI
 * 直调（与 AI 深度查错一致，不占用户并发槽），并做简单频控防滥用。
 */

const recentCalls = new Map<string, number[]>()

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const arr = (recentCalls.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) return false
  arr.push(now)
  recentCalls.set(key, arr)
  return true
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  if (!checkRateLimit(user.id, 10, 60_000)) {
    return NextResponse.json({ error: '摘要生成过于频繁，请 1 分钟后再试' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const chapterId = body?.chapterId
  if (!chapterId) return NextResponse.json({ error: '需要 chapterId' }, { status: 400 })

  const owned = await getOwnedChapter(user.id, chapterId)
  if (!owned) return NextResponse.json({ error: '章节不存在' }, { status: 404 })
  const chapter = await db.chapter.findUnique({ where: { id: chapterId } })
  if (!chapter) return NextResponse.json({ error: '章节不存在' }, { status: 404 })

  const plain = stripHtml(chapter.content || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)
  if (plain.length < 100) {
    return NextResponse.json({ error: '章节正文过短，无法生成摘要' }, { status: 400 })
  }

  const aiConfig =
    (await db.userAiConfig.findFirst({
      where: { userId: user.id, enabled: true, isDefault: true },
    })) || (await getPlatformDefaultAI())
  if (!aiConfig) {
    return NextResponse.json({ error: '未配置可用的 AI 接口' }, { status: 400 })
  }

  const res = await callThirdPartyAI(
    aiConfig,
    [
      {
        role: 'system',
        content: '你是网文章节摘要生成器。只输出摘要正文，不输出标题、解释、前言或Markdown标记。',
      },
      {
        role: 'user',
        content: `请为以下网文章节写一段 100—150 字的核心事件摘要，涵盖本章关键冲突、转折与章末钩子，供后续章节续写时感知前情。\n\n【章节：${chapter.title}】\n${plain}`,
      },
    ],
    { stream: false }
  )

  if (!res.ok || !res.reply) {
    return NextResponse.json({ error: res.error || 'AI 调用失败' }, { status: 500 })
  }

  const summary = res.reply
    .replace(/^\s*(?:#{1,6}\s*)?(?:摘要|章节摘要)[：:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!summary) {
    return NextResponse.json({ error: 'AI 未返回有效摘要' }, { status: 500 })
  }

  await db.chapter.update({ where: { id: chapterId }, data: { summary } })
  return NextResponse.json({ summary })
}
