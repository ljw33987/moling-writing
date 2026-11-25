import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformDefaultAI } from '@/lib/platform-ai'

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

  if (user.tokens <= 0) {
    return NextResponse.json({ error: 'Token 余额不足' }, { status: 402 })
  }

  const body = await req.json()
  const { text, mode = 'review' } = body // mode: 'review' | 'rewrite'
  if (!text?.trim()) {
    return NextResponse.json({ error: '请提供待审查文本' }, { status: 400 })
  }

  const plain = stripHtml(text).slice(0, 4000)
  const aiConfig =
    (await db.userAiConfig.findFirst({
      where: { userId: user.id, enabled: true, isDefault: true },
    })) || (await getPlatformDefaultAI())

  if (!aiConfig) {
    return NextResponse.json({ error: '请先在设置中配置 AI 模型' }, { status: 400 })
  }

  const systemPrompt =
    mode === 'rewrite'
      ? '你是资深中文网文主编，擅长消除“AI 味”（如过度对称排比、空洞抒情总结、“然而/不禁/仿佛”高频套话、机械过渡句）。请直接输出去 AI 味后的自然口语化/网文化正文，保持原情节和人设不变，不要解释。'
      : '你是资深中文网文主编，请指出以下正文中的“AI 味”问题（模板化衔接、形容词堆叠、句式过于工整、说教式结尾等），给出 3-5 条具体修改建议。'

  const res = await callThirdPartyAI(
    aiConfig,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: plain },
    ],
    { stream: false }
  )

  if (!res.ok) {
    return NextResponse.json({ error: res.error || 'AI 调用失败' }, { status: 500 })
  }

  const tokensUsed = Math.ceil((plain.length + (res.reply?.length || 0)) / 3)
  await db.user.update({
    where: { id: user.id },
    data: { tokens: Math.max(0, user.tokens - tokensUsed) },
  })

  return NextResponse.json({ reply: res.reply || '', tokensUsed })
}
