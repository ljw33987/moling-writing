import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAIWithFallback, getPlatformAiCandidates } from '@/lib/platform-ai'
import { getOwnedNovel } from '@/lib/ownership'
import { AI_BANNED_PHRASES } from '@/lib/ai-tells'
import { buildWritingStyleInstruction, HUMAN_VOICE_SYSTEM_RULES, PROSE_FINAL_AUDIT_RULES, PROSE_REFINEMENT_RULES, resolveWritingStyleForNovel } from '@/lib/writing-style'
import { formatScanForPrompt, scanAiTells } from '@/lib/ai-tells-scan'
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
    const { text, mode = 'review', novelId } = body
    if (!text?.trim()) {
      return NextResponse.json({ error: '请提供待审查文本' }, { status: 400 })
    }

    if (novelId != null && (typeof novelId !== 'string' || !await getOwnedNovel(user.id, novelId))) {
      return NextResponse.json({ error: '未找到作品' }, { status: 404 })
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

    const activeStyle = await resolveWritingStyleForNovel(user.id, novelId)
    const style = buildWritingStyleInstruction(activeStyle, mode === 'rewrite' ? 'prose' : 'review')
    // 确定性体检：把「句长方差 / 连接词密度 / 短语重复 / 套话命中」算成证据，
    // 改写时才有据可依，不再靠模型自己猜哪里像 AI。
    const scan = scanAiTells(plain)
    const scanBlock = formatScanForPrompt(scan)
    const taskPrompt =
      mode === 'rewrite'
        ? `你是资深网文编辑，执行「整章去 AI 味定点修改」。正文以 AI 初稿为主。你只负责输出「病灶句修改清单」，绝不输出整章正文——未列入清单的句子将由系统逐字保留。
${scanBlock}
【输出格式（严格遵守，违反即失败）】
只输出一个 JSON 数组，禁止输出整章正文、解释或 Markdown 代码块：
[{"original":"从原文逐字复制的原句，含原有标点","rewritten":"修改后的句子"}]
- original 必须从原文逐字复制（包括全角半角、破折号、省略号、奇怪的断句习惯），否则系统无法定位替换。
- rewritten 只改病灶：重组句式、删套话、换成具体表达；禁止顺手统一标点，禁止改动原句中与病灶无关的任何部分。
- 只列病灶句，没有问题的句子绝不列出；最多 20 条，按严重程度排序。若全文没有病灶，输出 []。
【体检使用方式】
- 体检点名的位置优先处理；破折号密度超标时，只削「解释补充类」用法（——也就是说），「打断、顿挫类」（压到——半）保留，那是节奏不是病。
${PROSE_REFINEMENT_RULES}
【文风基线（与「润色」预设同源）】
${HUMAN_VOICE_SYSTEM_RULES}
【润色成果保护（决定哪些句子不算病灶）】
- 已经口语化、具体化、没有套话的表达是此前润色的成果，视为作者选择，不要列入清单。
【比喻分级（决定哪些句子算病灶）】
- 带具体信息、有画面的比喻是正样本，不许列入：「像谁把生锈的针管泡在福尔马林里晃了三天」这类必须保留。
- 只有空装饰类比（「X般的Y」「像裹了蜜的刀」）和命中禁语的句子才列。
【禁语清单（rewritten 中不得出现任何一个；原句命中的必须列入清单改掉）】
${AI_BANNED_PHRASES.join('、')}
【rewritten 硬性底线】
- 剧情事实、规则条目、数字、人物称呼不变；篇幅与信息量接近原句。
- 删修饰后变没脾气就把情绪搬到动作上，不要造比喻顶包。`
        : `你是资深中文网文主编，请对以下正文做“表达模式诊断”。目标是找到影响阅读的机械表达，不根据单个词语或句子长短武断判断作者身份。
${scanBlock}
请按以下结构输出：
1. **诊断结论**：低 / 中 / 高风险，并说明主要依据。不要使用伪精确百分制。
2. **作者文风基线**：概括本文稳定存在的视角、句段节奏、对白密度与修辞习惯，后续判断必须以此为基线。
3. **证据清单**：最多列 6 项。每项引用原句，标明问题类型、阅读影响和判断置信度。重点检查机械复述、无依据总结、连续同构句、生硬转折、播音腔对白、人物反应跳步与因果断层。
4. **保留项**：指出哪些重复、短句、修辞或口头表达属于有功能的作者选择，不建议改动。
5. **最小改写示范**：只改 2~3 个最确定的问题，给出“原句 → 建议”，保持人物口吻和原文信息量。

必须优先引用机器体检给出的统计证据，再补充体检没覆盖到的口语与对白问题。
禁止因为出现“仿佛、然而、深吸一口气”等单个词就判定有问题；必须结合频率、上下文功能和作者文风判断。`

    const systemPrompt = style ? `${taskPrompt}\n\n${style}` : taskPrompt
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
