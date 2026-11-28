import { db } from '@/lib/db'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformConfig, getPlatformAiCandidates, callThirdPartyAIWithFallback, type AiEndpointConfig } from '@/lib/platform-ai'
import { parseModelMappings } from '@/lib/ai-models'
import { assembleNovelContext } from '@/lib/context-assembler'
import { runChapterGuardSafely } from '@/lib/guard'
import { extractAndSaveChapterMemory } from '@/lib/chapter-memory'
import { buildWritingStyleInstruction, PROSE_FINAL_AUDIT_RULES, PROSE_REFINEMENT_RULES, resolveWritingStyleForNovel } from '@/lib/writing-style'
import { formatScanForPrompt, scanAiTells } from '@/lib/ai-tells-scan'
import ZAI from 'z-ai-web-dev-sdk'

const activeRuns = new Set<string>()

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

export function isAutoSerialRunning(taskId: string): boolean {
  return activeRuns.has(taskId)
}

export async function runAutoSerialChapter(taskId: string): Promise<{
  ok: boolean
  chapter?: { id: string; title: string; words: number }
  error?: string
}> {
  if (activeRuns.has(taskId)) {
    return { ok: false, error: '当前任务正在生成中，请稍候' }
  }
  activeRuns.add(taskId)

  try {
    const task = await db.autoSerial.findUnique({ where: { id: taskId } })
    if (!task) return { ok: false, error: '连载任务不存在' }

    await db.autoSerial.update({
      where: { id: task.id },
      data: { status: 'running', lastError: null },
    })

    const user = await db.user.findUnique({ where: { id: task.userId } })
    if (!user || user.tokens <= 0) {
      throw new Error('Token 余额不足，无法生成新章节')
    }

    const novel = await db.novel.findUnique({
      where: { id: task.novelId },
      include: {
        volumes: {
          orderBy: { sortOrder: 'asc' },
        },
        chapters: {
          orderBy: { sortOrder: 'desc' },
          take: 3,
        },
      },
    })
    if (!novel) throw new Error('作品不存在')

    const extraRows = await db.$queryRaw<Array<{ startChapterNum: number | null; targetVolumeId: string | null }>>`
      SELECT startChapterNum, targetVolumeId FROM AutoSerial WHERE id = ${task.id} LIMIT 1
    `.catch(() => [])
    const configuredStartNum = (task as any).startChapterNum ?? extraRows[0]?.startChapterNum ?? null
    const configuredTargetVolId = (task as any).targetVolumeId ?? extraRows[0]?.targetVolumeId ?? null

    let targetVolume = configuredTargetVolId
      ? novel.volumes.find((v) => v.id === configuredTargetVolId)
      : undefined
    if (!targetVolume) {
      const nonOutline = novel.volumes.filter((v) => !v.isOutline)
      targetVolume = nonOutline[nonOutline.length - 1] || novel.volumes[novel.volumes.length - 1]
    }
    if (!targetVolume) {
      targetVolume = await db.volume.create({
        data: {
          title: '第一卷',
          sortOrder: 0,
          novelId: novel.id,
        },
      })
    }

    const totalChapters = await db.chapter.count({ where: { novelId: novel.id } })
    const chapterNum =
      configuredStartNum && configuredStartNum >= 1 ? configuredStartNum : totalChapters + 1
    const maxSortInVol = await db.chapter.aggregate({
      where: { volumeId: targetVolume.id },
      _max: { sortOrder: true },
    })

    // 分层上下文装配（续写模式：大纲/时间线/活跃伏笔/前情摘要/末尾原文/设定池，带 token 预算）
    const assembly = await assembleNovelContext({
      novelId: novel.id,
      budgetTokens: 16000,
      asNextChapter: true,
    })
    if (assembly.preflight.warnings.length > 0) {
      console.log(`[auto-serial] 上下文装配预警：${assembly.preflight.warnings.join('；')}`)
    }

    const activeStyle = await resolveWritingStyleForNovel(task.userId, novel.id)
    const styleInstruction = buildWritingStyleInstruction(activeStyle)

    const buildMessages = (wordHint?: string) => [
      {
        role: 'system' as const,
        content:
          '你是专业的长篇网文作家，擅长根据大纲、人设与前情自然连载下一章正文。回复请使用中文。' +
          '\n\n' + styleInstruction,
      },
      {
        role: 'user' as const,
        content:
          `请为小说《${novel.title}》创作第 ${chapterNum} 章。\n` +
          (task.plotDirection ? `本阶段剧情走向提示：${task.plotDirection}\n\n` : '\n') +
          `【全书上下文资料（创作必须严格遵循以下大纲、设定、时间线、伏笔与前情）】\n${assembly.contextText}\n\n` +
          `创作要求：\n` +
          `1. 第一行请输出章节标题（格式：第${chapterNum}章 章节名），第二行空行，随后直接输出正文。\n` +
          `2. 正文字数约 ${task.targetWords} 字，节奏紧凑、画面感强。\n` +
          `3. 自然衔接前文与大纲，保持人物性格一致，不要输出任何额外解释或 Markdown 标记。` +
          (wordHint ? `\n\n【重要】${wordHint}` : ''),
      },
    ]

    // 解析平台默认映射与备选接口池（按优先级自动降级）
    const platformConfig = await getPlatformConfig()
    const mappings = parseModelMappings((platformConfig as any).modelMappings)
    const defaultMapping = mappings.find((m) => m.enabled !== false && m.isDefault) || mappings[0]

    let preferred: AiEndpointConfig | null = null
    if (defaultMapping?.configId) {
      const bound = await db.userAiConfig.findFirst({
        where: { id: defaultMapping.configId, enabled: true },
      })
      if (bound) {
        preferred = { id: bound.id, name: bound.name, baseUrl: bound.baseUrl, apiKey: bound.apiKey, model: bound.model }
      }
    }
    if (!preferred && defaultMapping && (defaultMapping.realModel || defaultMapping.baseUrl || defaultMapping.apiKey)) {
      const baseUrl = (defaultMapping.baseUrl || platformConfig.defaultAiBaseUrl || '').trim()
      const apiKey = (defaultMapping.apiKey || platformConfig.defaultAiApiKey || '').trim()
      const model = (defaultMapping.realModel || platformConfig.defaultAiModel || '').trim()
      if (baseUrl && apiKey && !apiKey.startsWith('****') && model) {
        preferred = { baseUrl, apiKey, model }
      }
    }

    const aiCandidates = await getPlatformAiCandidates(preferred)

    const parseReply = (raw: string) => {
      const lines = raw.replace(/\r\n?/g, '\n').split('\n')
      const firstNonEmptyIdx = lines.findIndex((l) => l.trim().length > 0)
      let title = `第${chapterNum}章`
      let bodyText = raw
      if (firstNonEmptyIdx >= 0) {
        const candidate = lines[firstNonEmptyIdx].replace(/^#+\s*/, '').trim()
        if (candidate.length <= 40) {
          title = candidate
          bodyText = lines.slice(firstNonEmptyIdx + 1).join('\n').trim()
        }
      }
      return { title, bodyText }
    }

    /** 单次完整生成：正文生成 → 去AI味精修 → 标题/正文解析 */
    const attemptGeneration = async (wordHint?: string) => {
      let rawReply = ''
      if (aiCandidates.length > 0) {
        const res = await callThirdPartyAIWithFallback(aiCandidates, buildMessages(wordHint))
        if (!res.ok) throw new Error(res.error || 'AI 接口调用失败')
        rawReply = res.reply || ''
      } else {
        const zai = await ZAI.create()
        const completion: any = await zai.chat.completions.create({
          messages: buildMessages(wordHint),
          thinking: { type: 'disabled' },
        } as any)
        rawReply = completion.choices?.[0]?.message?.content || ''
      }
      if (!rawReply.trim()) throw new Error('AI 未返回有效章节内容')

      let { title, bodyText } = parseReply(rawReply)

      // 自动连载去AI味精修：保留全部剧情与细节，消除模板化连接词与播音腔
      let extraTokensUsed = 0
      if (aiCandidates.length > 0 && bodyText.trim().length > 100) {
        const deAiMessages = [
          {
            role: 'system' as const,
            content: `你是资深中文网文主编，负责对自动连载生成的章节做“去AI味”自然化精修。
${formatScanForPrompt(scanAiTells(bodyText))}
${PROSE_REFINEMENT_RULES}
${PROSE_FINAL_AUDIT_RULES}
${styleInstruction}
直接输出正文，省去章节标题和 Markdown 标记。`,
          },
          {
            role: 'user' as const,
            content: bodyText,
          },
        ]
        const deAiRes = await callThirdPartyAIWithFallback(aiCandidates, deAiMessages).catch(() => null)
        if (deAiRes?.ok && deAiRes.reply && deAiRes.reply.trim().length >= bodyText.trim().length * 0.6) {
          bodyText = deAiRes.reply.trim()
          extraTokensUsed = Math.ceil((bodyText.length * 2) / 3)
        }
      }

      const words = bodyText.replace(/\s/g, '').length
      return { title, bodyText, words, rawReplyLen: rawReply.length, extraTokensUsed }
    }

    // 第一次生成；字数不达标自动重试 1 次（取字数更多的稿件）
    const minWords = Math.max(200, Math.floor(task.targetWords * 0.8))
    let attempt = await attemptGeneration()
    if (attempt.words < minWords) {
      console.log(`[auto-serial] 字数不足（${attempt.words}/${minWords}），自动重试 1 次`)
      const retry = await attemptGeneration(
        `上一稿仅约 ${attempt.words} 字，未达到约 ${task.targetWords} 字的要求。请在保持剧情完整的前提下把正文写足 ${task.targetWords} 字左右。`
      )
      if (retry.words > attempt.words) attempt = retry
    }

    const htmlContent = plainTextToHtml(attempt.bodyText)
    const words = attempt.words

    const chapter = await db.chapter.create({
      data: {
        title: attempt.title,
        content: htmlContent,
        words,
        sortOrder: (maxSortInVol._max.sortOrder ?? -1) + 1,
        status: 'draft',
        volumeId: targetVolume.id,
        novelId: novel.id,
      },
    })

    const nextTotalWords = novel.totalWords + words
    await db.novel.update({
      where: { id: novel.id },
      data: { totalWords: nextTotalWords },
    })

    // 章后记忆沉淀（摘要/时间线/伏笔回填，尽力而为，失败不阻塞）
    const memory = await extractAndSaveChapterMemory({
      novelId: novel.id,
      chapterId: chapter.id,
      chapterNum,
      aiCandidates,
    })

    // 生成后质量闸门：确定性守卫校验，告警只记录不重试（最低 Token 成本策略）
    await runChapterGuardSafely(novel.id, chapter.id, attempt.title)

    const tokensUsed =
      Math.ceil((assembly.contextText.length + attempt.bodyText.length) / 3) +
      attempt.extraTokensUsed +
      memory.tokensUsed
    await db.user.updateMany({
      where: { id: user.id, tokens: { gte: tokensUsed } },
      data: { tokens: { decrement: tokensUsed } },
    }).then(async (r) => {
      if (r.count === 0) {
        await db.user.update({ where: { id: user.id }, data: { tokens: 0 } })
      }
    })

    const now = new Date()
    await db.autoSerial.update({
      where: { id: task.id },
      data: {
        status: 'idle',
        lastRunAt: now,
        nextRunAt: task.enabled ? new Date(now.getTime() + task.intervalMin * 60 * 1000) : null,
        totalGenerated: task.totalGenerated + 1,
        lastError: null,
      },
    })
    if (configuredStartNum && configuredStartNum >= 1) {
      await db.$executeRaw`UPDATE AutoSerial SET startChapterNum = ${configuredStartNum + 1} WHERE id = ${task.id}`
    }

    return {
      ok: true,
      chapter: { id: chapter.id, title: chapter.title, words: chapter.words },
    }
  } catch (e: any) {
    await db.autoSerial
      .update({
        where: { id: taskId },
        data: { status: 'error', lastError: e.message || '生成失败' },
      })
      .catch(() => {})
    return { ok: false, error: e.message || '生成失败' }
  } finally {
    activeRuns.delete(taskId)
  }
}
