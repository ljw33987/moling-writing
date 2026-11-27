import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { PRESETS } from '../route'
import { createThinkStreamFilter, stripThinkTags } from '@/lib/ai-providers'
import { getPlatformConfig, getPlatformAiCandidates, callThirdPartyAIWithFallback, type AiEndpointConfig } from '@/lib/platform-ai'
import { getPlatformProAiFromEnv, parseModelMappings } from '@/lib/ai-models'
import { assembleNovelContext, resolveReferencedContext } from '@/lib/context-assembler'
import { getOwnedChapter, getOwnedNovel } from '@/lib/ownership'
import { buildWritingStyleInstruction, HUMAN_VOICE_SYSTEM_RULES, resolveWritingStyleForNovel } from '@/lib/writing-style'
import { allowsAiProseWriteback } from '@/lib/ai-writing-intent'
import ZAI from 'z-ai-web-dev-sdk'

// POST /api/ai/stream - 流式 AI 调用（SSE）
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  if (user.tokens <= 0) {
    return NextResponse.json(
      { error: 'Token 余额不足，请充值' },
      { status: 402 }
    )
  }

  const body = await req.json()
  const { action, preset, message, novelId, chapterId: rawChapterId, targetStyle, modelId, referencedItems, writingStyleId, promptTags } = body

  if (novelId && !await getOwnedNovel(user.id, novelId)) {
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }
  let chapterId: string | null = rawChapterId || null
  if (chapterId) {
    const chapter = await getOwnedChapter(user.id, chapterId)
    if (!chapter || (novelId && chapter.novelId !== novelId)) {
      if (novelId) {
        // 若前端缓存了已删除或旧作品的 chapterId，自动降级为仅按当前作品上下文生成
        chapterId = null
      } else {
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
  const matchedMapping = modelId
    ? mappings.find((m) => m.enabled !== false && m.aliasId === modelId)
    : mappings.find((m) => m.enabled !== false && m.isDefault) || mappings[0]

  if (matchedMapping?.isPro || modelId === 'baogeng_v4_pro' || modelId === 'moling_v4_pro') {
    systemPrompt += '\n\n【深度分析与精修模式】请对引用材料与上下文进行结构化、深层次的推演、拆解与高质量输出。'
  }

  // 注入个人写作风格（显式选择或作品绑定的文风）
  const activeStyle = await resolveWritingStyleForNovel(user.id, novelId, writingStyleId)
  if (activeStyle) {
    systemPrompt += `\n\n${buildWritingStyleInstruction(activeStyle)}`
  }

  const readOnlyChat = action === 'chat' && preset !== 'chapter_gen' &&
    !allowsAiProseWriteback(message || '', preset)
  if (!readOnlyChat) {
    systemPrompt += `\n\n${HUMAN_VOICE_SYSTEM_RULES}`
  }
  if (readOnlyChat) {
    systemPrompt += '\n\n【只读分析】回答用户的问题。审稿或查错时，只报告问题、证据和建议，不改写或重发整章正文。'
  } else if (refChapters.length >= 2) {
    const chapterList = refChapters.map((c: any, idx: number) => `${idx + 1}. ${c.title}`).join('、')
    systemPrompt += `\n\n【多章节协同任务强制规范】用户本次显式 @ 引用了 ${refChapters.length} 个章节（${chapterList}）。如果用户要求修改、润色、去AI味或重写，你必须按顺序逐一全部处理并输出这 ${refChapters.length} 个章节的完整内容，严禁只输出最后一章或遗漏任何一章！每一章都必须严格以二级标题 \`## 章节原标题\`（例如 \`## ${refChapters[0].title}\`）单独成行开头，紧接着输出该章完整正文，以便系统自动分章精准写回对应章节。`
    if (action !== 'edit' && userPrompt) {
      userPrompt = `请对以下全部 ${refChapters.length} 个引用章节（${chapterList}）依次执行指令，务必逐章全部输出且每章以 \`## 章节原标题\` 开头：\n\n${userPrompt}`
    }
  }

  if (!readOnlyChat && Array.isArray(promptTags) && promptTags.length > 0) {
    const validTags = promptTags.map((t: any) => String(t || '').trim()).filter(Boolean)
    if (validTags.length > 0) {
      systemPrompt += `\n\n【附加创作与输出要求】\n${validTags.map((t: string, idx: number) => `${idx + 1}. ${t}`).join('\n')}`
    }
  }

  let preferredConfig: AiEndpointConfig | null = null

  if (matchedMapping?.configId) {
    const bound = await db.userAiConfig.findFirst({
      where: { id: matchedMapping.configId, enabled: true },
    })
    if (bound) {
      preferredConfig = {
        id: bound.id,
        name: bound.name,
        baseUrl: bound.baseUrl,
        apiKey: bound.apiKey,
        model: bound.model,
      }
    }
  }

  if (!preferredConfig && matchedMapping && (matchedMapping.realModel || matchedMapping.baseUrl || matchedMapping.apiKey)) {
    const baseUrl = matchedMapping.baseUrl || platformConfig.defaultAiBaseUrl
    const apiKey = matchedMapping.apiKey || platformConfig.defaultAiApiKey
    const model = matchedMapping.realModel || platformConfig.defaultAiModel
    if (baseUrl && apiKey && model) {
      preferredConfig = { baseUrl, apiKey, model }
    }
  }

  if (!preferredConfig && (matchedMapping?.isPro || modelId === 'baogeng_v4_pro' || modelId === 'moling_v4_pro')) {
    const proEnv = getPlatformProAiFromEnv()
    if (proEnv) {
      preferredConfig = proEnv
    }
  }

  const aiCandidates = await getPlatformAiCandidates(preferredConfig)
  const hasThirdPartyAi = aiCandidates.length > 0

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
          const result = await callThirdPartyAIWithFallback(aiCandidates, messages, { stream: true })
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

        if (isCancelled()) return
        // 计算消耗 + 保存记录
        const tokensUsed = Math.ceil((userPrompt.length + fullReply.length) / 3)
        await db.user.update({
          where: { id: user.id },
          data: { tokens: Math.max(0, user.tokens - tokensUsed) },
        })
        await db.chatMessage.create({
          data: {
            role: 'user',
            content: userPrompt,
            preset: preset || null,
            novelId: novelId || null,
            chapterId: chapterId || null,
            tokensUsed,
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

        if (isCancelled()) return
        // 发送结束事件
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokensUsed, remainingTokens: Math.max(0, user.tokens - tokensUsed) })}\n\n`))
        controller.close()
      } catch (e: any) {
        if (isCancelled()) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`))
        controller.close()
      }
    },
    cancel() {
      cancelled = true
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
