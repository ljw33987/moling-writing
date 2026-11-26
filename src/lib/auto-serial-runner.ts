import { db } from '@/lib/db'
import { callThirdPartyAI } from '@/lib/ai-providers'
import { getPlatformConfig } from '@/lib/platform-ai'
import { parseModelMappings } from '@/lib/ai-models'
import { stripHtml } from '@/lib/context-assembler'
import { buildWritingStyleInstruction, resolveWritingStyleForNovel } from '@/lib/writing-style'
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

    const characters = await db.character.findMany({
      where: {
        userId: task.userId,
        OR: [{ novelId: novel.id }, { novelId: null }],
      },
      take: 20,
    })

    const charInfo = characters
      .map((c) => `${c.name}（性格：${c.personality || '未知'}；能力：${c.abilities || '无'}）`)
      .join('；')

    const recentChapters = novel.chapters
      .slice()
      .reverse()
      .map((c) => `【${c.title}】\n${stripHtml(c.content || '').slice(-800)}`)
      .join('\n\n---\n\n')

    const userPrompt = `请为小说《${novel.title}》创作第 ${chapterNum} 章。
题材类型：${novel.genre}
作品简介：${novel.synopsis || '（未填写）'}
全书大纲：${novel.outline || '（未填写）'}
${task.plotDirection ? `本阶段剧情走向提示：${task.plotDirection}` : ''}
核心角色设定：${charInfo || '（暂无）'}

最近章节末尾内容：
${recentChapters || '（这是开篇第一章）'}

创作要求：
1. 第一行请输出章节标题（格式：第${chapterNum}章 章节名），第二行空行，随后直接输出正文。
2. 正文字数约 ${task.targetWords} 字，节奏紧凑、画面感强。
3. 自然衔接前文与大纲，保持人物性格一致，不要输出任何额外解释或 Markdown 标记。`

    const activeStyle = await resolveWritingStyleForNovel(task.userId, novel.id)
    const styleInstruction = activeStyle ? `\n\n${buildWritingStyleInstruction(activeStyle)}` : ''

    const messages = [
      {
        role: 'system',
        content:
          '你是专业的长篇网文作家，擅长根据大纲、人设与前文自然连载下一章正文。回复请使用中文。' +
          styleInstruction,
      },
      { role: 'user', content: userPrompt },
    ]

    // 解析 AI 配置（与 /api/ai/stream 保持一致：用户默认配置 -> 平台映射/默认配置 -> 内置 ZAI）
    let aiConfig: { baseUrl: string; apiKey: string; model: string } | null = null

    const userAi = await db.userAiConfig.findFirst({
      where: { userId: task.userId, enabled: true, isDefault: true },
    })
    if (userAi && userAi.apiKey?.trim() && !userAi.apiKey.startsWith('****')) {
      aiConfig = {
        baseUrl: userAi.baseUrl.trim(),
        apiKey: userAi.apiKey.trim(),
        model: userAi.model.trim(),
      }
    }

    if (!aiConfig) {
      const platformConfig = await getPlatformConfig()
      const mappings = parseModelMappings((platformConfig as any).modelMappings)
      const defaultMapping = mappings.find((m) => m.enabled !== false && m.isDefault) || mappings[0]

      if (defaultMapping && (defaultMapping.realModel || defaultMapping.baseUrl || defaultMapping.apiKey)) {
        const baseUrl = (defaultMapping.baseUrl || platformConfig.defaultAiBaseUrl || '').trim()
        const apiKey = (defaultMapping.apiKey || platformConfig.defaultAiApiKey || '').trim()
        const model = (defaultMapping.realModel || platformConfig.defaultAiModel || '').trim()
        if (baseUrl && apiKey && !apiKey.startsWith('****') && model) {
          aiConfig = { baseUrl, apiKey, model }
        }
      }

      if (
        !aiConfig &&
        platformConfig.defaultAiApiKey?.trim() &&
        !platformConfig.defaultAiApiKey.startsWith('****') &&
        platformConfig.defaultAiBaseUrl?.trim() &&
        platformConfig.defaultAiModel?.trim()
      ) {
        aiConfig = {
          baseUrl: platformConfig.defaultAiBaseUrl.trim(),
          apiKey: platformConfig.defaultAiApiKey.trim(),
          model: platformConfig.defaultAiModel.trim(),
        }
      }
    }

    let reply = ''
    if (aiConfig) {
      const res = await callThirdPartyAI(aiConfig, messages)
      if (!res.ok) throw new Error(res.error || 'AI 接口调用失败')
      reply = res.reply || ''
    } else {
      const zai = await ZAI.create()
      const completion: any = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      } as any)
      reply = completion.choices?.[0]?.message?.content || ''
    }

    if (!reply.trim()) throw new Error('AI 未返回有效章节内容')

    const lines = reply.replace(/\r\n?/g, '\n').split('\n')
    const firstNonEmptyIdx = lines.findIndex((l) => l.trim().length > 0)
    let title = `第${chapterNum}章`
    let bodyText = reply
    if (firstNonEmptyIdx >= 0) {
      const candidate = lines[firstNonEmptyIdx].replace(/^#+\s*/, '').trim()
      if (candidate.length <= 40) {
        title = candidate
        bodyText = lines.slice(firstNonEmptyIdx + 1).join('\n').trim()
      }
    }

    const htmlContent = plainTextToHtml(bodyText)
    const words = bodyText.replace(/\s/g, '').length

    const chapter = await db.chapter.create({
      data: {
        title,
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

    const tokensUsed = Math.ceil((userPrompt.length + reply.length) / 3)
    await db.user.update({
      where: { id: user.id },
      data: { tokens: Math.max(0, user.tokens - tokensUsed) },
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
