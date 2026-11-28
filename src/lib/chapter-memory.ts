import { db } from '@/lib/db'
import { stripHtml } from '@/lib/context-assembler'
import { callThirdPartyAIWithFallback, getPlatformAiCandidates, type AiEndpointConfig } from '@/lib/platform-ai'
import { chapterMemorySchema, extractJsonFromAiReply } from '@/lib/multi-agent-writing'

/**
 * 章后记忆沉淀模块（"边写边攒"记忆正循环）
 *
 * 章节落库后调用 AI 提取结构化记忆并回填数据库：
 * - Chapter.summary（章节摘要，供上下文装配引擎第 4 层使用）
 * - TimelineEvent（时间线锚点，供第 3 层使用）
 * - Foreshadowing（伏笔登记/回收，供装配引擎伏笔层使用）
 *
 * 提取 prompt 设计参考 oh-story（MIT License, github.com/zenstory-ai/oh-story-claudecode）
 * 的章节拆解指令思想改编：只提取正文明确出现的信息，严禁杜撰。
 *
 * 本模块为"尽力而为"附加步骤：任何失败仅记录日志，不抛出、不阻塞章节落库主流程。
 */

const EXTRACT_SYSTEM_PROMPT = `你是网文连载的章节记忆提取器。请从章节正文中提取结构化记忆数据。
【硬性规则】
1. 只提取正文中明确出现或可直接确认的信息，严禁凭空杜撰、严禁推测后续剧情。
2. 忽略正文没有实质推进的重复描写；同一事件只记一条。
3. timelineEvents 只记推动剧情的关键事件（战斗结果、重要决定、场景转换、重要关系变化），每次最多 3 条。
4. foreshadowing 只记真正的悬念/伏笔（预示后文的钩子），日常情节不算；每次最多 3 条。
5. 必须输出严格合法的 JSON，不要 markdown 代码块包裹，不要任何解释文字。

JSON Schema：
{
  "summary": "100-180字本章核心事件摘要，包含关键转折与结果",
  "timelineEvents": [
    { "timeLabel": "时间锚点（如：第三日深夜），无明确时间则写'本章'", "title": "关键事件短标题", "description": "事件因果与影响（50字内）" }
  ],
  "foreshadowing": [
    { "status": "new | resolved", "content": "埋下的新伏笔内容，或已回收的旧伏笔描述" }
  ]
}
无内容的数组留空 []。`

export interface ChapterMemoryResult {
  ok: boolean
  tokensUsed: number
  summarySaved: boolean
  timelineSaved: number
  foreshadowPlanted: number
  foreshadowResolved: number
  error?: string
}

/**
 * bigram 重合度匹配：用于把"已回收伏笔"对齐到库中的活跃伏笔。
 * 返回 0~1 的相似分（共享二元组占比）。
 */
export function foreshadowSimilarity(a: string, b: string): number {
  const clean = (s: string) => s.replace(/[\s，。、！？：；"'"'（）()《》\-—·]/g, '')
  const sa = clean(a)
  const sb = clean(b)
  if (sa.length < 2 || sb.length < 2) return 0
  const bigrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ba = bigrams(sa)
  const bb = bigrams(sb)
  if (ba.size === 0 || bb.size === 0) return 0
  let shared = 0
  for (const g of ba) if (bb.has(g)) shared++
  return shared / Math.min(ba.size, bb.size)
}

const RESOLVE_MATCH_THRESHOLD = 0.35

function parseProgressNotes(raw: string | null): Array<{ chapterNum: number; note: string }> {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * 章后提取并回填记忆（尽力而为，失败不抛出）。
 * @param aiCandidates 备选 AI 接口池（由调用方传入，如自动连载 runner 的降级池）；不传则取平台候选
 */
export async function extractAndSaveChapterMemory(params: {
  novelId: string
  chapterId: string
  chapterNum?: number
  aiCandidates?: AiEndpointConfig[]
}): Promise<ChapterMemoryResult> {
  const fail = (error: string): ChapterMemoryResult => ({
    ok: false,
    tokensUsed: 0,
    summarySaved: false,
    timelineSaved: 0,
    foreshadowPlanted: 0,
    foreshadowResolved: 0,
    error,
  })

  try {
    const chapter = await db.chapter.findUnique({
      where: { id: params.chapterId },
      select: { id: true, novelId: true, title: true, content: true },
    })
    if (!chapter || chapter.novelId !== params.novelId) return fail('章节不存在')

    const plain = stripHtml(chapter.content || '').trim()
    if (plain.length < 200) return fail('章节正文过短，跳过记忆提取')

    const candidates =
      params.aiCandidates && params.aiCandidates.length > 0
        ? params.aiCandidates
        : await getPlatformAiCandidates(null)

    let reply = ''
    let tokensUsed = 0
    if (candidates.length > 0) {
      const res = await callThirdPartyAIWithFallback(
        candidates,
        [
          { role: 'system' as const, content: EXTRACT_SYSTEM_PROMPT },
          {
            role: 'user' as const,
            content: `章节标题：${chapter.title}\n\n请从以下章节正文中提取结构化记忆数据：\n\n${plain.slice(0, 6000)}`,
          },
        ],
        { stream: false }
      )
      if (!res.ok || !res.reply?.trim()) return fail(res.error || 'AI 提取失败')
      reply = res.reply
      tokensUsed = Math.ceil((plain.slice(0, 6000).length + reply.length) / 3)
    } else {
      return fail('无可用 AI 接口，跳过记忆提取')
    }

    const parsed = extractJsonFromAiReply(reply)
    if (!parsed) return fail('AI 返回内容无法解析为 JSON')
    const memory = chapterMemorySchema.safeParse(parsed)
    if (!memory.success) return fail('提取结果字段校验未通过')
    const data = memory.data

    let summarySaved = false
    let timelineSaved = 0
    let foreshadowPlanted = 0
    let foreshadowResolved = 0

    // 1. 回填章节摘要（不覆盖已有摘要）
    if (data.summary && !data.summary.startsWith('（')) {
      await db.chapter.update({
        where: { id: chapter.id },
        data: { summary: data.summary },
      })
      summarySaved = true
    }

    // 2. 回填时间线锚点
    for (const ev of data.timelineEvents) {
      await db.timelineEvent.create({
        data: {
          novelId: params.novelId,
          chapterId: chapter.id,
          timeLabel: ev.timeLabel.slice(0, 120),
          title: ev.title.slice(0, 160),
          description: ev.description?.slice(0, 2000) || null,
        },
      })
      timelineSaved++
    }

    // 3. 伏笔登记 / 回收
    const activeForeshadowings = await db.foreshadowing.findMany({
      where: { novelId: params.novelId, status: { in: ['planted', 'advanced'] } },
      orderBy: { hintWeight: 'desc' },
      take: 100,
    })

    for (const f of data.foreshadowing) {
      if (f.status === 'new') {
        // 与活跃伏笔去重：相似度过高的不重复登记
        const dup = activeForeshadowings.some(
          (a) => foreshadowSimilarity(a.title + (a.description || ''), f.content) >= 0.6
        )
        if (dup) continue
        await db.foreshadowing.create({
          data: {
            novelId: params.novelId,
            title: f.content.slice(0, 60),
            description: f.content.slice(0, 2000),
            status: 'planted',
            plantedChapter: params.chapterNum ?? null,
            plantedAt: new Date(),
            hintWeight: 2,
          },
        })
        foreshadowPlanted++
      } else {
        // resolved：对齐库中活跃伏笔，命中则流转状态并追加推进记录
        let best: { id: string; score: number } | null = null
        for (const a of activeForeshadowings) {
          const score = foreshadowSimilarity(a.title + (a.description || ''), f.content)
          if (!best || score > best.score) best = { id: a.id, score }
        }
        if (best && best.score >= RESOLVE_MATCH_THRESHOLD) {
          const target = activeForeshadowings.find((a) => a.id === best!.id)!
          const notes = parseProgressNotes(target.progressNotes)
          notes.push({ chapterNum: params.chapterNum ?? 0, note: `回收：${f.content.slice(0, 200)}` })
          await db.foreshadowing.update({
            where: { id: best.id },
            data: {
              status: 'resolved',
              resolvedChapter: params.chapterNum ?? null,
              progressNotes: JSON.stringify(notes.slice(-20)),
            },
          })
          foreshadowResolved++
        }
        // 未命中活跃伏笔的 resolved 视为正文自问自答的短悬念，跳过
      }
    }

    console.log(
      `[chapter-memory] 「${chapter.title}」记忆沉淀完成：摘要=${summarySaved ? 1 : 0} 时间线=${timelineSaved} 伏笔新埋=${foreshadowPlanted} 回收=${foreshadowResolved}`
    )

    return { ok: true, tokensUsed, summarySaved, timelineSaved, foreshadowPlanted, foreshadowResolved }
  } catch (err: any) {
    console.error('[chapter-memory] 记忆提取失败（忽略，不阻塞主流程）:', err)
    return fail(err?.message || '记忆提取异常')
  }
}
