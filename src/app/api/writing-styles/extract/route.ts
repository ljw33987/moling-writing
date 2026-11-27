import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformDefaultAI } from '@/lib/platform-ai'
import { acquireUserAiSlot, checkRateLimit, reserveUserTokens, settleUserTokens } from '@/lib/concurrency'
import ZAI from 'z-ai-web-dev-sdk'

// POST /api/writing-styles/extract - 从作者样文中 AI 提炼个人文风特征
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const rl = checkRateLimit(`ai:${user.id}`, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后再试` }, { status: 429 })
  }
  const slot = acquireUserAiSlot(user.id, 3)
  if (!slot.ok) {
    return NextResponse.json({ error: '您有多个 AI 任务正在生成中，请稍候再试' }, { status: 429 })
  }

  let reserved = 0
  let settled = false
  try {
    const body = await req.json()
    const sampleText = String(body?.sampleText || '').trim().slice(0, 4000)
    if (sampleText.length < 80) {
      return NextResponse.json({ error: '请至少粘贴 80 字以上的正文样文，以便准确提炼文风' }, { status: 400 })
    }

    const reserve = await reserveUserTokens(user.id, 150)
    if (!reserve.ok) {
      return NextResponse.json({ error: '剩余可用字数不足，请充值' }, { status: 402 })
    }
    reserved = reserve.reserved

    const aiConfig =
      (await db.userAiConfig.findFirst({
        where: { userId: user.id, enabled: true, isDefault: true },
      })) || (await getPlatformDefaultAI())

    const messages = [
      {
        role: 'system',
        content: `你是资深文学与网文文风分析专家。请深度分析用户提供的样文，提炼出可直接用于指导 AI 模仿写作的风格规范。
请严格输出合法 JSON（不要附加 Markdown 解释），格式如下：
{
  "name": "4-10字的文风名称（如：冷峻短句悬疑风）",
  "description": "一句话概括这种文风的核心特点（30字内）",
  "stylePrompt": "分点写出具体的写作规范（120-260字），必须包含：1) 叙事视角与人称习惯；2) 句式长短与分段节奏；3) 用词质感（如口语化/白描/古雅/克制/犀利）；4) 对话比例与人物说话口吻；5) 情绪与画面表现方式（如少用形容词、多用动作细节推进）。"
}`,
      },
      {
        role: 'user',
        content: `请分析以下样文的写作风格：\n\n${sampleText}`,
      },
    ]

    let reply = ''
    let apiTokens: number | undefined
    if (aiConfig) {
      const res = (await callThirdPartyAI(aiConfig, messages, { stream: false })) as {
        ok: boolean
        reply?: string
        error?: string
        totalTokens?: number
      }
      if (!res.ok) {
        await settleUserTokens(user.id, reserved, 0)
        settled = true
        return NextResponse.json({ error: res.error || 'AI 提炼失败' }, { status: 500 })
      }
      reply = res.reply || ''
      apiTokens = res.totalTokens
    } else {
      const zai = await ZAI.create()
      const completion: any = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      } as any)
      reply = completion.choices?.[0]?.message?.content || ''
    }

    if (!reply.trim()) {
      await settleUserTokens(user.id, reserved, 0)
      settled = true
      return NextResponse.json({ error: 'AI 未返回有效分析结果' }, { status: 500 })
    }

    const tokensUsed =
      apiTokens && apiTokens > 0
        ? apiTokens
        : Math.ceil((sampleText.length + reply.length) / 3)
    const remainingTokens = await settleUserTokens(user.id, reserved, tokensUsed)
    settled = true

    let parsed: { name?: string; description?: string; stylePrompt?: string } = {}
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      }
    } catch {
      parsed = {
        name: '自定义提炼文风',
        description: '基于样文提炼的个人写作风格',
        stylePrompt: reply.trim(),
      }
    }

    return NextResponse.json({
      name: parsed.name || '自定义提炼文风',
      description: parsed.description || '基于样文提炼的个人写作风格',
      stylePrompt: parsed.stylePrompt || reply.trim(),
      tokensUsed,
      remainingTokens,
    })
  } finally {
    if (reserved > 0 && !settled) {
      await settleUserTokens(user.id, reserved, 0).catch(() => {})
    }
    slot.release()
  }
}
