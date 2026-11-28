import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { MAX_CHAPTER_DRAFT_LENGTH } from '@/lib/ai-writing-intent'
import { requireSessionOr401 } from '@/lib/auth'
import { stripThinkTags } from '@/lib/ai-providers'
import {
  getPlatformConfig,
  getWritingAiCandidates,
  callThirdPartyAIWithFallback,
} from '@/lib/platform-ai'
import { hasProAiAccess, parseModelMappings, requiresProAiModel, resolveAiModelMapping } from '@/lib/ai-models'
import { assembleNovelContext } from '@/lib/context-assembler'
import { getOwnedChapter, getOwnedNovel } from '@/lib/ownership'
import {
  buildWritingStyleInstruction,
  resolveWritingStyleForNovel,
} from '@/lib/writing-style'
import {
  acquireUserAiSlot,
  checkRateLimit,
  reserveUserTokens,
  settleUserTokens,
} from '@/lib/concurrency'
import {
  AGENT_TEMPERATURE,
  buildAgentPrompt,
  chapterMemorySaveSchema,
  chapterMemorySchema,
  extractJsonFromAiReply,
  type AgentRoleId,
} from '@/lib/multi-agent-writing'
import { buildSkillInjectionPrompt } from '@/lib/writing-skills'
import ZAI from 'z-ai-web-dev-sdk'

export async function POST(req: NextRequest) {
  let userId = ''
  let reserved = 0
  let settled = false
  let slotRelease: (() => void) | null = null

  try {
    const session = await requireSessionOr401()
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: 401 })
    }
    const user = session.user
    userId = user.id

    const rl = checkRateLimit(`ai:${user.id}`, 30, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: `AI 请求过于频繁，请 ${rl.retryAfterSec} 秒后再试` },
        { status: 429 }
      )
    }

    const slot = acquireUserAiSlot(user.id, 3)
    if (!slot.ok) {
      return NextResponse.json(
        { error: '您有多个 AI 任务正在生成中，请稍候再试' },
        { status: 429 }
      )
    }
    slotRelease = slot.release

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '无效的请求体' }, { status: 400 })
    }
    const {
      agentId,
      novelId,
      chapterId: rawChapterId,
      userGoal = '',
      targetWords = 2000,
      draftText = '',
      upstreamOutputs = {},
      modelId,
      writingStyleId,
      skillIds,
      customInstruction,
    } = body as {
      agentId: AgentRoleId
      novelId: string
      chapterId?: string | null
      userGoal?: string
      targetWords?: number
      draftText?: string
      upstreamOutputs?: Partial<Record<AgentRoleId, string>>
      modelId?: string
      writingStyleId?: string | null
      skillIds?: string[]
      customInstruction?: string
    }

    if (typeof agentId !== 'string' || !Object.hasOwn(AGENT_TEMPERATURE, agentId)) {
      return NextResponse.json({ error: '无效的智能体角色' }, { status: 400 })
    }
    if (
      typeof novelId !== 'string' || !novelId ||
      (rawChapterId != null && typeof rawChapterId !== 'string') ||
      typeof userGoal !== 'string' || typeof draftText !== 'string' || draftText.length > MAX_CHAPTER_DRAFT_LENGTH ||
      (modelId != null && typeof modelId !== 'string') ||
      !upstreamOutputs || typeof upstreamOutputs !== 'object' ||
      (customInstruction != null && typeof customInstruction !== 'string')
    ) {
      return NextResponse.json({ error: '写作任务参数无效或正文过长' }, { status: 400 })
    }
    if (!(await getOwnedNovel(user.id, novelId))) {
      return NextResponse.json({ error: '未找到作品' }, { status: 404 })
    }

    const platformConfig = await getPlatformConfig()
    const mappings = parseModelMappings(platformConfig?.modelMappings)
    const matchedMapping = resolveAiModelMapping(mappings, modelId)
    const isProModel = requiresProAiModel(modelId, matchedMapping)
    if (isProModel && !hasProAiAccess(user.plan)) {
      return NextResponse.json(
        { error: '免费版仅可使用 v4 标准模型，升级月卡或年卡会员后方可使用 Pro 模型' },
        { status: 403 }
      )
    }

    const chapterId: string | null = rawChapterId || null
    if (chapterId) {
      const owned = await getOwnedChapter(user.id, chapterId)
      if (!owned || owned.novelId !== novelId) {
        return NextResponse.json({ error: '未找到章节' }, { status: 404 })
      }
    }

    const reserve = await reserveUserTokens(user.id, 200)
    if (!reserve.ok) {
      return NextResponse.json(
        { error: 'Token 余额不足，请充值' },
        { status: 402 }
      )
    }
    reserved = reserve.reserved

    const startedAt = Date.now()

    const usesStyle = agentId === 'writer' || agentId === 'actor' || agentId === 'reviewer'
    const [assembled, resolvedStyle] = await Promise.all([
      assembleNovelContext({
        novelId,
        chapterId,
        budgetTokens: agentId === 'explore' ? 16000 : 10000,
      }),
      usesStyle
        ? resolveWritingStyleForNovel(user.id, novelId, writingStyleId)
        : Promise.resolve(null),
    ])

    const { system, user: userPrompt } = buildAgentPrompt({
      agentId,
      userGoal,
      targetWords: Math.max(800, Math.min(6000, Number(targetWords) || 2000)),
      draftText,
      upstreamOutputs,
    })

    const { promptBlock: skillBlock, appliedSkillNames } = buildSkillInjectionPrompt(
      skillIds,
      agentId
    )
    const customBlock = customInstruction?.trim()
      ? `\n\n【作者自定义智能体指令（Prompt Chain）】\n${customInstruction.trim()}`
      : ''

    const style = usesStyle ? buildWritingStyleInstruction(resolvedStyle, agentId === 'reviewer' ? 'review' : 'prose') : ''
    const styleBlock = style ? `\n\n${style}` : ''
    const fullSystem = `${system}${skillBlock}${customBlock}${styleBlock}\n\n【作品实时上下文（唯一事实来源）】\n${assembled.contextText}`
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: fullSystem },
      { role: 'user', content: userPrompt },
    ]

    const aiCandidates = await getWritingAiCandidates(platformConfig, mappings, matchedMapping, isProModel, user.plan)
    let reply = ''
    let reportedTokens = 0
    let modelLabel = matchedMapping?.displayName || '默认模型'

    if (aiCandidates.length > 0) {
      const result = await callThirdPartyAIWithFallback(aiCandidates, messages, {
        temperature: AGENT_TEMPERATURE[agentId],
        signal: req.signal,
      })
      if (!result.ok) {
        return NextResponse.json(
          { error: `AI 调用失败：${result.error}` },
          { status: 500 }
        )
      }
      reply = (result.reply || '').trim()
      reportedTokens = result.totalTokens || 0
      if (result.usedConfig?.model && !matchedMapping?.displayName) {
        modelLabel = result.usedConfig.name || result.usedConfig.model
      }
    } else {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      })
      reply = stripThinkTags(completion.choices[0]?.message?.content || '').trim()
    }

    const tokensUsed = reportedTokens || Math.ceil((fullSystem.length + userPrompt.length + reply.length) / 3)
    const remainingTokens = await settleUserTokens(user.id, reserved, tokensUsed)
    settled = true

    if (!reply) {
      return NextResponse.json({ error: 'AI 未返回有效内容，请重试' }, { status: 502 })
    }

    let structuredData: unknown = null
    if (agentId === 'extractor') {
      const extracted = chapterMemorySchema.safeParse(extractJsonFromAiReply(reply))
      if (extracted.success) structuredData = extracted.data
    } else if (agentId === 'character_designer') {
      structuredData = extractJsonFromAiReply(reply)
    }

    return NextResponse.json({
      ok: true,
      agentId,
      output: reply,
      structuredData,
      appliedSkills: appliedSkillNames,
      tokensUsed,
      remainingTokens,
      durationMs: Date.now() - startedAt,
      modelLabel,
    })
  } catch (e: any) {
    console.error('[multi-agent] error:', e)
    return NextResponse.json(
      { error: e?.message || '多智能体执行失败' },
      { status: 500 }
    )
  } finally {
    if (!settled && userId && reserved > 0) {
      await settleUserTokens(userId, reserved, 0).catch(() => {})
    }
    slotRelease?.()
  }
}


function newEntries<T>(entries: T[], existingKeys: string[], keyOf: (entry: T) => string) {
  const seen = new Set(existingKeys)
  return entries.filter((entry) => {
    const key = keyOf(entry)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const parsed = chapterMemorySaveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '待写入的章节设定格式有误' }, { status: 400 })
  const { novelId, chapterId, expectedSummary, summary, characters, worldviews, items, timelineEvents } = parsed.data
  const userId = session.user.id

  const result = await db.$transaction(async (tx) => {
    const chapter = await tx.chapter.findFirst({
      where: { id: chapterId, novelId, novel: { userId, deleted: false } },
      select: { title: true, summary: true },
    })
    if (!chapter) return { status: 404, error: '未找到原章节' } as const
    if (summary && summary !== chapter.summary && chapter.summary !== expectedSummary) {
      return { status: 409, error: '原章摘要已更新，请重新提取后再写入' } as const
    }

    const scope = { userId, novelId }
    const [existingCharacters, existingWorldviews, existingItems, existingEvents, lastEvent] = await Promise.all([
      tx.character.findMany({ where: { ...scope, name: { in: characters.map((entry) => entry.name) } }, select: { name: true } }),
      tx.worldview.findMany({ where: { ...scope, name: { in: worldviews.map((entry) => entry.name) } }, select: { name: true } }),
      tx.item.findMany({ where: { ...scope, name: { in: items.map((entry) => entry.name) } }, select: { name: true } }),
      tx.timelineEvent.findMany({ where: { novelId, chapterId }, select: { title: true } }),
      tx.timelineEvent.aggregate({ where: { novelId }, _max: { sortOrder: true } }),
    ])

    const pendingCharacters = newEntries(characters, existingCharacters.map((entry) => entry.name), (entry) => entry.name)
    const pendingWorldviews = newEntries(worldviews, existingWorldviews.map((entry) => entry.name), (entry) => entry.name)
    const pendingItems = newEntries(items, existingItems.map((entry) => entry.name), (entry) => entry.name)
    const pendingEvents = newEntries(timelineEvents, existingEvents.map((entry) => entry.title), (entry) => entry.title)
    const updateSummary = !!summary && summary !== chapter.summary

    if (updateSummary) await tx.chapter.update({ where: { id: chapterId }, data: { summary } })
    if (pendingCharacters.length) await tx.character.createMany({ data: pendingCharacters.map((entry) => ({ ...entry, ...scope })) })
    if (pendingWorldviews.length) await tx.worldview.createMany({ data: pendingWorldviews.map((entry) => ({ ...entry, ...scope })) })
    if (pendingItems.length) await tx.item.createMany({ data: pendingItems.map((entry) => ({ ...entry, ...scope })) })
    if (pendingEvents.length) {
      await tx.timelineEvent.createMany({
        data: pendingEvents.map((entry, index) => ({
          ...entry, novelId, chapterId,
          timeLabel: entry.timeLabel || chapter.title,
          sortOrder: (lastEvent._max.sortOrder ?? 0) + index + 1,
        })),
      })
    }

    const saved = Number(updateSummary) + pendingCharacters.length + pendingWorldviews.length + pendingItems.length + pendingEvents.length
    const requested = Number(!!summary) + characters.length + worldviews.length + items.length + timelineEvents.length
    return { status: 200, saved, skipped: requested - saved, summary: summary || undefined } as const
  }).catch((error: unknown) => {
    console.error('[chapter-memory] save failed', error)
    return { status: 500, error: '写入失败，所选内容可以重新提交' } as const
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ saved: result.saved, skipped: result.skipped, summary: result.summary })
}
