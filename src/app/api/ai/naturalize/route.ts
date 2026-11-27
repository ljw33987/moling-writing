import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAIWithFallback, getPlatformAiCandidates } from '@/lib/platform-ai'
import { HUMAN_VOICE_SYSTEM_RULES } from '@/lib/writing-style'
import { acquireUserAiSlot, checkRateLimit, reserveUserTokens, settleUserTokens } from '@/lib/concurrency'

/**
 * 统计章节中 AI 溯源段落与人工段落占比（基于 Provenance data-ai-run-id 属性）
 */
export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const chapterId = new URL(req.url).searchParams.get('chapterId')
  if (!chapterId) return NextResponse.json({ error: '需要 chapterId' }, { status: 400 })

  const chapter = await db.chapter.findUnique({ where: { id: chapterId } })
  if (!chapter) return NextResponse.json({ error: '章节不存在' }, { status: 404 })

  const html = chapter.content || ''
  let aiChars = 0
  let humanChars = 0
  let aiParagraphs = 0
  let humanParagraphs = 0

  if (html.includes('<p')) {
    const pRegex = /<p([^>]*)>([\s\S]*?)<\/p>/gi
    let m: RegExpExecArray | null
    while ((m = pRegex.exec(html)) !== null) {
      const attrs = m[1] || ''
      const text = stripHtml(m[2] || '').replace(/\s/g, '')
      if (!text) continue
      if (/data-ai-run-id=/i.test(attrs)) {
        aiParagraphs++
        aiChars += text.length
      } else {
        humanParagraphs++
        humanChars += text.length
      }
    }
  } else {
    humanChars = stripHtml(html).replace(/\s/g, '').length
    humanParagraphs = html ? html.split('\n').filter((l) => l.trim()).length : 0
  }

  const totalChars = aiChars + humanChars
  const aiRatio = totalChars > 0 ? Math.round((aiChars / totalChars) * 100) : 0

  return NextResponse.json({
    chapterId,
    title: chapter.title,
    aiChars,
    humanChars,
    totalChars,
    aiParagraphs,
    humanParagraphs,
    aiRatio,
  })
}

/**
 * POST /api/ai/naturalize - 自然化去 AI 味审查与改写
 */
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const rl = checkRateLimit(`ai:${user.id}`, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: `AI 请求过于频繁，请 ${rl.retryAfterSec} 秒后再试` }, { status: 429 })
  }

  const slot = acquireUserAiSlot(user.id, 3)
  if (!slot.ok) {
    return NextResponse.json({ error: '您有多个 AI 任务正在生成中，请稍候再试' }, { status: 429 })
  }

  let reserved = 0
  let settled = false
  try {
    const body = await req.json()
    const { text, mode = 'review' } = body // mode: 'review' | 'rewrite'
    if (!text?.trim()) {
      return NextResponse.json({ error: '请提供待审查文本' }, { status: 400 })
    }

    const plain = stripHtml(text).slice(0, 4000)
    const aiCandidates = await getPlatformAiCandidates()

    if (aiCandidates.length === 0) {
      return NextResponse.json({ error: '请先在管理后台配置 AI 接口' }, { status: 400 })
    }

    const reserve = await reserveUserTokens(user.id, 150)
    if (!reserve.ok) {
      return NextResponse.json({ error: 'Token 余额不足' }, { status: 402 })
    }
    reserved = reserve.reserved

    const systemPrompt =
      mode === 'rewrite'
        ? `你是资深中文小说主编，最擅长把有“AI 味”的段落洗成活生生的人类作家手写质感。
${HUMAN_VOICE_SYSTEM_RULES}
改写规则：
- 严格保留原情节、人物设定与关键信息点，不得删减剧情。
- 彻底重写所有翻译腔、总结腔、播音腔对白和模板化衔接词（如“然而、不禁、仿佛、一抹、眼神微眯、深吸一口气”），换成更接地气、有呼吸感的人类正常说话与叙事口吻。
- 直接输出改写后的干净正文（不要任何解释、标题或前后缀）。`
        : `你是资深中文网文主编，请对以下正文做深度“AI 味指纹诊断”。
请按以下结构输出：
1. **AI 味指数**：0~100 分（越高越像 AI 生成）及一句话总评。
2. **命中问题点**：逐条指出文中的模板化衔接、形容词堆叠、句式过于工整、播音腔对话或说教式结尾。
3. **人类口吻改写示范**：挑出 2~3 句最明显的 AI 味原句，给出「原句 → 人类自然口吻改写」对照示范。`

    const res = await callThirdPartyAIWithFallback(
      aiCandidates,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: plain },
      ],
      { stream: false }
    ) as { ok: boolean; reply?: string; error?: string; totalTokens?: number }

    if (!res.ok) {
      await settleUserTokens(user.id, reserved, 0)
      settled = true
      return NextResponse.json({ error: res.error || 'AI 调用失败' }, { status: 500 })
    }

    const tokensUsed =
      res.totalTokens && res.totalTokens > 0
        ? res.totalTokens
        : Math.ceil((plain.length + (res.reply?.length || 0)) / 3)
    const remainingTokens = await settleUserTokens(user.id, reserved, tokensUsed)
    settled = true

    return NextResponse.json({ reply: res.reply || '', tokensUsed, remainingTokens })
  } finally {
    if (reserved > 0 && !settled) {
      await settleUserTokens(user.id, reserved, 0).catch(() => {})
    }
    slot.release()
  }
}
