import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { PRESETS } from '../route'
import { createThinkStreamFilter, stripThinkTags } from '@/lib/ai-providers'
import { getPlatformConfig, getWritingAiCandidates, callThirdPartyAIWithFallback } from '@/lib/platform-ai'
import { hasProAiAccess, parseModelMappings, requiresProAiModel, resolveAiModelMapping } from '@/lib/ai-models'
import { assembleNovelContext, resolveReferencedContext } from '@/lib/context-assembler'
import { getOwnedChapter, getOwnedNovel } from '@/lib/ownership'
import { buildWritingStyleInstruction, resolveWritingStyleForNovel } from '@/lib/writing-style'
import { allowsAiProseWriteback, MAX_CHAPTER_DRAFT_LENGTH } from '@/lib/ai-writing-intent'
import { buildSkillInjectionForAssistant } from '@/lib/writing-skills'
import { acquireUserAiSlot, checkRateLimit, reserveUserTokens, settleUserTokens } from '@/lib/concurrency'
import ZAI from 'z-ai-web-dev-sdk'

// POST /api/ai/stream - 流式 AI 调用（SSE）
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

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

  const reserve = await reserveUserTokens(user.id, 200)
  if (!reserve.ok) {
    slot.release()
    return NextResponse.json(
      { error: 'Token 余额不足，请充值' },
      { status: 402 }
    )
  }
  const reserved = reserve.reserved
  let settled = false
  const releaseAll = async (actualUsed = 0) => {
    if (!settled) {
      settled = true
      await settleUserTokens(user.id, reserved, actualUsed).catch(() => {})
    }
    slot.release()
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    await releaseAll(0)
    return NextResponse.json({ error: '无效的请求体' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    await releaseAll(0)
    return NextResponse.json({ error: '无效的请求体' }, { status: 400 })
  }

  const { action, preset, message, novelId, chapterId: rawChapterId, targetStyle, modelId, referencedItems, writingStyleId, promptTags, skillIds, chapterDraft } = body

  if (novelId && !await getOwnedNovel(user.id, novelId)) {
    await releaseAll(0)
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }
  let chapterId: string | null = rawChapterId || null
  if (chapterId) {
    const chapter = await getOwnedChapter(user.id, chapterId)
    if (!chapter || (novelId && chapter.novelId !== novelId)) {
      if (novelId && chapterDraft === undefined) {
        // 若前端缓存了已删除或旧作品的 chapterId，自动降级为仅按当前作品上下文生成
        chapterId = null
      } else {
        await releaseAll(0)
        return NextResponse.json({ error: '未找到章节' }, { status: 404 })
      }
    }
  }

  let systemPrompt = '你是一位专业的网文创作助手，帮助作者完成小说创作任务。回复请使用中文。'
  let userPrompt = message || ''
  let extraContext = ''

  // 分层装配长篇上下文（大纲 + @引用设定 + 时间线 + 前情摘要 + 当前正文）
  const refChapters = Array.isArray(referencedItems)
    ? referencedItems.filter((r: any) => r?.type === 'chapter' && r?.title)
    : []

  if (novelId) {
    const [assembled, explicitRefs] = await Promise.all([
      assembleNovelContext({ novelId, chapterId }),
      resolveReferencedContext(novelId, referencedItems || [], refChapters.length >= 2 ? 32000 : 24000),
    ])
    extraContext = [assembled.contextText, explicitRefs].filter(Boolean).join('\n\n')
  }

  if (preset && PRESETS[preset]) {
    systemPrompt = PRESETS[preset].system
  }

  if (action === 'edit') {
    const editPrompt: Record<string, string> = {
      polish: '请润色以下文本：',
      expand: '请扩写以下文本：',
      shorten: '请缩写以下文本：',
      style_change: `请将以下文本改写为「${targetStyle || '古风'}」文风：`,
      continue: '请续写以下文本：',
    }
    userPrompt = `${editPrompt[preset] || '请处理以下文本：'}\n\n${message || ''}`
  }

  // 解析后台模型映射：将对外别名（如 baogeng_v4 / baogeng_v4_pro）映射为实际底层接口与模型
  const platformConfig = await getPlatformConfig()
  const mappings = parseModelMappings((platformConfig as any).modelMappings)
  const matchedMapping = resolveAiModelMapping(mappings, modelId)
  const isProModel = requiresProAiModel(modelId, matchedMapping)

  if (isProModel) {
    if (!hasProAiAccess(user.plan)) {
      await releaseAll(0)
      return NextResponse.json(
        { error: '免费版仅可使用 v4 标准模型，升级月卡或年卡会员后方可使用 Pro 模型' },
        { status: 403 }
      )
    }
    systemPrompt += '\n\n【深度分析与精修模式】请对引用材料与上下文进行结构化、深层次的推演、拆解与高质量输出。'
  }

  const readOnlyChat = action === 'chat' && preset !== 'chapter_gen' &&
    !allowsAiProseWriteback(message || '', preset)
  if (readOnlyChat) {
    systemPrompt += '\n\n【只读分析】回答用户的问题。审稿或查错时，只报告问题、证据和建议，不改写或重发整章正文。'
  } else if (chapterDraft === undefined && refChapters.length >= 2) {
    const chapterList = refChapters.map((c: any, idx: number) => `${idx + 1}. ${c.title}`).join('、')
    systemPrompt += `\n\n【多章节协同任务强制规范】用户本次显式 @ 引用了 ${refChapters.length} 个章节（${chapterList}）。如果用户要求修改、润色、去AI味或重写，你必须按顺序逐一全部处理并输出这 ${refChapters.length} 个章节的完整内容，严禁只输出最后一章或遗漏任何一章！每一章都必须严格以二级标题 \`## 章节原标题\`（例如 \`## ${refChapters[0].title}\`）单独成行开头，紧接着输出该章完整正文，以便系统自动分章精准写回对应章节。`
    if (action !== 'edit' && userPrompt) {
      userPrompt = `请对以下全部 ${refChapters.length} 个引用章节（${chapterList}）依次执行指令，务必逐章全部输出且每章以 \`## 章节原标题\` 开头：\n\n${userPrompt}`
    }
  }

  const { promptBlock: syncedSkillBlock, appliedSkillNames } = buildSkillInjectionForAssistant(
    Array.isArray(skillIds) ? skillIds : undefined,
    readOnlyChat ? 'readonly' : 'prose',
    preset,
    typeof message === 'string' ? message : ''
  )
  if (syncedSkillBlock) {
    systemPrompt += syncedSkillBlock
  }

  if (!readOnlyChat && Array.isArray(promptTags) && promptTags.length > 0) {
    const validTags = promptTags.map((t: any) => String(t || '').trim()).filter(Boolean)
    if (validTags.length > 0) {
      systemPrompt += `\n\n【附加创作与输出要求】\n${validTags.map((t: string, idx: number) => `${idx + 1}. ${t}`).join('\n')}`
    }
  }

  if (preset !== 'style_change' && (!readOnlyChat || preset === 'editor_review')) {
    const activeStyle = await resolveWritingStyleForNovel(user.id, novelId, writingStyleId)
    const style = buildWritingStyleInstruction(activeStyle, readOnlyChat ? 'review' : 'prose')
    if (style) systemPrompt += `\n\n${style}`
  }

  const aiCandidates = await getWritingAiCandidates(platformConfig, mappings, matchedMapping, isProModel, user.plan)
  const hasThirdPartyAi = aiCandidates.length > 0

  if (chapterId && typeof chapterDraft === 'string' && chapterDraft.trim()) {
    if (chapterDraft.length > MAX_CHAPTER_DRAFT_LENGTH) {
      await releaseAll(0)
      return NextResponse.json({ error: '正文超出单次处理范围，请分段处理' }, { status: 400 })
    }
    userPrompt += `\n\n【作者当前编辑的正文】\n${chapterDraft}`
  }

  const messages = [
    { role: 'system', content: systemPrompt + (extraContext ? `\n\n以下是创作上下文：${extraContext}` : '') },
    { role: 'user', content: userPrompt || '请帮我继续创作。' },
  ]

  // 创建 SSE 流
  const encoder = new TextEncoder()
  let fullReply = ''
  const thinkFilter = createThinkStreamFilter()
  let cancelled = false
  const isCancelled = () => cancelled || req.signal.aborted

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (hasThirdPartyAi) {
          // 按优先级依次尝试平台接口池，遇到 429/异常自动切换备选接口（流式）
          const result = await callThirdPartyAIWithFallback(aiCandidates, messages, {
            stream: true,
            signal: req.signal,
          })
          if (isCancelled()) {
            await result.stream?.cancel()
            return
          }

          if (!result.ok) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: result.error })}\n\n`))
            controller.close()
            return
          }

          if (result.stream) {
            // 第三方流式响应（OpenAI 兼容 SSE 格式）
            const reader = result.stream.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
              const { done, value } = await reader.read()
              if (isCancelled()) {
                await reader.cancel()
                return
              }
              if (done) break
              buffer += decoder.decode(value, { stream: true })

              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim()
                  if (data === '[DONE]') continue
                  try {
                    const parsed = JSON.parse(data)
                    const delta = parsed.choices?.[0]?.delta?.content || ''
                    if (delta) {
                      const cleanDelta = thinkFilter.push(delta)
                      if (cleanDelta) {
                        fullReply += cleanDelta
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: cleanDelta })}\n\n`))
                      }
                    }
                  } catch { }
                }
              }
            }
          } else {
            // 非流式降级
            fullReply = stripThinkTags(result.reply || '')
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: fullReply })}\n\n`))
          }
        } else {
          // 兜底：使用内置 z-ai（流式）
            const zai = await ZAI.create()
            const completion: any = await zai.chat.completions.create({
              messages,
              thinking: { type: 'disabled' },
              stream: true,
            } as any)

            const reader = (completion as ReadableStream<Uint8Array>).getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
              const { done, value } = await reader.read()
              if (isCancelled()) {
                await reader.cancel()
                return
              }
              if (done) break
              buffer += decoder.decode(value, { stream: true })

              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim()
                  if (data === '[DONE]') continue
                  try {
                    const parsed = JSON.parse(data)
                    const delta = parsed.choices?.[0]?.delta?.content || ''
                    if (delta) {
                      const cleanDelta = thinkFilter.push(delta)
                      if (cleanDelta) {
                        fullReply += cleanDelta
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: cleanDelta })}\n\n`))
                      }
                    }
                  } catch { }
                }
              }
          }
        }

        if (isCancelled()) {
          const partialUsed =
            fullReply.length > 0 ? Math.ceil((userPrompt.length + fullReply.length) / 3) : 0
          await releaseAll(partialUsed)
          return
        }
        // 计算消耗 + 原子结算 + 保存记录（仅在 assistant 消息记录 tokensUsed，避免后台统计翻倍）
        const tokensUsed = Math.ceil((userPrompt.length + fullReply.length) / 3)
        settled = true
        const remainingTokens = await settleUserTokens(user.id, reserved, tokensUsed)
        await db.chatMessage.create({
          data: {
            role: 'user',
            content: userPrompt,
            preset: preset || null,
            novelId: novelId || null,
            chapterId: chapterId || null,
            tokensUsed: 0,
            userId: user.id,
          },
        })
        await db.chatMessage.create({
          data: {
            role: 'assistant',
            content: fullReply,
            preset: preset || null,
            novelId: novelId || null,
            chapterId: chapterId || null,
            tokensUsed,
            userId: user.id,
          },
        })

        if (isCancelled()) {
          slot.release()
          return
        }
        // 发送结束事件
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokensUsed, remainingTokens, appliedSkills: appliedSkillNames })}\n\n`))
        controller.close()
        slot.release()
      } catch (e: any) {
        await releaseAll(0)
        if (isCancelled()) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`))
        controller.close()
      }
    },
    cancel() {
      cancelled = true
      void releaseAll(0)
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
