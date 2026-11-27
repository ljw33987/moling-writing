import { db } from '@/lib/db'

export interface ContextLayerInfo {
  key: string
  label: string
  tokens: number
  budgetTokens: number
  trimmed: boolean
  itemCount: number
  preview: string
}

export interface ContextAssemblyResult {
  contextText: string
  totalTokens: number
  budgetTokens: number
  trimmedLayers: string[]
  referencedCodexIds: string[]
  missingCodexIds: string[]
  layers: ContextLayerInfo[]
  preflight: {
    status: 'ready' | 'attention'
    warnings: string[]
  }
}

export function stripHtml(html: string): string {
  if (!html) return ''
  if (!html.includes('<')) return html
  return html
    .replace(/<div[^>]*data-ai-draft[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractCodexRefIds(html: string): string[] {
  if (!html) return []
  const ids = new Set<string>()
  const re = /data-codex-ref=["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1]) ids.add(m[1])
  }
  return [...ids]
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x4e00 && code <= 0x9fff) cjk++
    else other++
  }
  return Math.ceil(cjk * 0.75 + other * 0.3)
}

function fitToBudget(text: string, budgetTokens: number, fromTail = false): { text: string; trimmed: boolean } {
  if (!text) return { text: '', trimmed: false }
  const tokens = estimateTokens(text)
  if (tokens <= budgetTokens) return { text, trimmed: false }
  const ratio = Math.max(0.1, budgetTokens / Math.max(1, tokens))
  const keepChars = Math.max(80, Math.floor(text.length * ratio))
  if (fromTail) {
    return { text: '…\n' + text.slice(-keepChars), trimmed: true }
  }
  return { text: text.slice(0, keepChars) + '\n…（已按预算截断）', trimmed: true }
}

/**
 * 分层上下文装配引擎（移植自墨枢 Moshu）：
 * 按优先级装配：大纲定位 → 本章 @ 引用设定 → 时间线 → 前情摘要 → 其余设定 → 近文正文
 */
export async function assembleNovelContext(params: {
  novelId: string
  chapterId?: string | null
  budgetTokens?: number
}): Promise<ContextAssemblyResult> {
  const budgetTokens = params.budgetTokens ?? 14000
  const layers: ContextLayerInfo[] = []
  const trimmedLayers: string[] = []
  const warnings: string[] = []

  const [novel, characters, worldviews, items, currentChapter, allChapters] =
    await Promise.all([
      db.novel.findUnique({ where: { id: params.novelId } }),
      db.character.findMany({ where: { novelId: params.novelId } }),
      db.worldview.findMany({ where: { novelId: params.novelId } }),
      db.item.findMany({ where: { novelId: params.novelId } }),
      params.chapterId
        ? db.chapter.findUnique({ where: { id: params.chapterId } })
        : Promise.resolve(null),
      db.chapter.findMany({
        where: { novelId: params.novelId },
        orderBy: [{ volume: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        select: { id: true, title: true, summary: true, sortOrder: true, volumeId: true },
      }),
    ])

  let timelineEvents: Array<{ timeLabel: string; title: string; description: string | null }> = []
  try {
    timelineEvents = await (db as any).timelineEvent.findMany({
      where: { novelId: params.novelId },
      orderBy: { sortOrder: 'asc' },
      take: 25,
    })
  } catch {
    timelineEvents = []
  }

  let remaining = budgetTokens

  // 1. 作品定位与大纲（附带已有章节目录，防止 AI 重复章名或重复已写剧情）
  if (novel) {
    const existingList = allChapters.slice(-30).map((c) =>
      c.id === currentChapter?.id ? `${c.title}（当前所在章）` : c.title
    )
    const chapterIndexText =
      existingList.length > 0
        ? `\n已有章节目录（严禁重复使用已有章节标题或重写已写剧情）：${existingList.join(' / ')}`
        : ''
    const raw = `【当前小说】\n书名：${novel.title}\n类型：${novel.genre}\n简介：${novel.synopsis || '（未设定）'}\n大纲：${novel.outline || '（未设定）'}${chapterIndexText}`
    const layerBudget = Math.min(remaining, Math.floor(budgetTokens * 0.22))
    const fitted = fitToBudget(raw, layerBudget)
    const tokens = estimateTokens(fitted.text)
    remaining = Math.max(0, remaining - tokens)
    if (fitted.trimmed) trimmedLayers.push('outline')
    if (!novel.outline) warnings.push('本书尚未填写总大纲，长篇一致性可能受影响')
    layers.push({
      key: 'outline',
      label: '作品定位与大纲',
      tokens,
      budgetTokens: layerBudget,
      trimmed: fitted.trimmed,
      itemCount: 1,
      preview: fitted.text,
    })
  }

  // 2. 本章 @ 引用的设定（最高优先级记忆）
  const rawHtml = currentChapter?.content || ''
  const referencedIds = extractCodexRefIds(rawHtml)
  const codexById = new Map<string, { kind: string; text: string }>()
  for (const c of characters) {
    codexById.set(c.id, {
      kind: '角色',
      text: `- [角色] ${c.name}：性格=${c.personality || '未知'} | 背景=${c.background || '未知'} | 能力=${c.abilities || '无'}`,
    })
  }
  for (const w of worldviews) {
    codexById.set(w.id, {
      kind: '世界观',
      text: `- [世界观/${w.type}] ${w.name}：${w.description || '无'}`,
    })
  }
  for (const it of items) {
    codexById.set(it.id, {
      kind: '道具/功法',
      text: `- [道具/${it.type}] ${it.name}：属性=${it.attributes || '无'} | 效果=${it.effect || '无'}`,
    })
  }

  const missingCodexIds: string[] = []
  const refLines: string[] = []
  for (const id of referencedIds) {
    const entry = codexById.get(id)
    if (entry) refLines.push(entry.text)
    else missingCodexIds.push(id)
  }
  if (missingCodexIds.length > 0) {
    warnings.push(`本章有 ${missingCodexIds.length} 处 @ 引用指向了已删除的设定条目`)
  }
  if (refLines.length > 0 && remaining > 0) {
    const raw = `【本章显式引用的设定（@CodexRef）】\n${refLines.join('\n')}`
    const layerBudget = Math.min(remaining, Math.floor(budgetTokens * 0.25))
    const fitted = fitToBudget(raw, layerBudget)
    const tokens = estimateTokens(fitted.text)
    remaining = Math.max(0, remaining - tokens)
    if (fitted.trimmed) trimmedLayers.push('referenced_codex')
    layers.push({
      key: 'referenced_codex',
      label: '本章 @ 引用设定',
      tokens,
      budgetTokens: layerBudget,
      trimmed: fitted.trimmed,
      itemCount: refLines.length,
      preview: fitted.text,
    })
  }

  // 3. 时间线锚点
  if (timelineEvents.length > 0 && remaining > 0) {
    const raw = `【故事时间线】\n${timelineEvents
      .map((e) => `- [${e.timeLabel}] ${e.title}${e.description ? `：${e.description}` : ''}`)
      .join('\n')}`
    const layerBudget = Math.min(remaining, Math.floor(budgetTokens * 0.12))
    const fitted = fitToBudget(raw, layerBudget)
    const tokens = estimateTokens(fitted.text)
    remaining = Math.max(0, remaining - tokens)
    if (fitted.trimmed) trimmedLayers.push('timeline')
    layers.push({
      key: 'timeline',
      label: '故事时间线',
      tokens,
      budgetTokens: layerBudget,
      trimmed: fitted.trimmed,
      itemCount: timelineEvents.length,
      preview: fitted.text,
    })
  }

  // 4. 前情摘要（取当前章之前的最多 4 章摘要）
  if (currentChapter && remaining > 0) {
    const idx = allChapters.findIndex((c) => c.id === currentChapter.id)
    const prevChapters = idx > 0 ? allChapters.slice(Math.max(0, idx - 4), idx) : []
    const withSummary = prevChapters.filter((c) => c.summary?.trim())
    if (withSummary.length > 0) {
      const raw = `【前情章节摘要】\n${withSummary
        .map((c) => `- ${c.title}：${c.summary}`)
        .join('\n')}`
      const layerBudget = Math.min(remaining, Math.floor(budgetTokens * 0.15))
      const fitted = fitToBudget(raw, layerBudget)
      const tokens = estimateTokens(fitted.text)
      remaining = Math.max(0, remaining - tokens)
      if (fitted.trimmed) trimmedLayers.push('previous_summary')
      layers.push({
        key: 'previous_summary',
        label: '前情章节摘要',
        tokens,
        budgetTokens: layerBudget,
        trimmed: fitted.trimmed,
        itemCount: withSummary.length,
        preview: fitted.text,
      })
    }
  }

  // 5. 其余常驻设定（排除已显式引用的）
  const refSet = new Set(referencedIds)
  const otherLines: string[] = []
  for (const [id, entry] of codexById.entries()) {
    if (!refSet.has(id)) otherLines.push(entry.text)
  }
  if (otherLines.length > 0 && remaining > 0) {
    const raw = `【其余设定库参考】\n${otherLines.join('\n')}`
    const layerBudget = Math.min(remaining, Math.floor(budgetTokens * 0.16))
    const fitted = fitToBudget(raw, layerBudget)
    const tokens = estimateTokens(fitted.text)
    remaining = Math.max(0, remaining - tokens)
    if (fitted.trimmed) trimmedLayers.push('other_codex')
    layers.push({
      key: 'other_codex',
      label: '其余设定库',
      tokens,
      budgetTokens: layerBudget,
      trimmed: fitted.trimmed,
      itemCount: otherLines.length,
      preview: fitted.text,
    })
  }

  // 6. 当前章正文尾部（吃掉剩余预算；头部信息不参与尾部截断，避免丢失当前章节标题）
  if (currentChapter && remaining > 0) {
    const plainBody = stripHtml(currentChapter.content || '')
    const charCount = plainBody.replace(/\s/g, '').length
    const isEmptyChapter = charCount === 0
    const header = isEmptyChapter
      ? `【当前所在章节：${currentChapter.title}（尚未开始写作）】\n` +
        `本章核心事件：${currentChapter.summary || '（未设定）'}\n` +
        `提示：这是一个新章节，请依据用户本次给出的核心事件直接开写本章；` +
        `不要续写上一章、不要重复上一章的标题或已写情节。\n`
      : `【当前所在章节：${currentChapter.title}（已写 ${charCount} 字）】\n` +
        `核心事件：${currentChapter.summary || '（未设定）'}\n` +
        `提示：请以用户本次给出的核心事件与指令为准来写本章；` +
        `只有当核心事件确实是承接本章节时才继续往下写，` +
        `严禁重复下方已写的情节，也严禁重复「${currentChapter.title}」这个标题。\n` +
        `已写正文末尾：\n`
    const bodyBudget = Math.max(200, remaining - estimateTokens(header))
    const fittedBody = fitToBudget(plainBody || '（暂无正文）', bodyBudget, true)
    const raw = header + fittedBody.text
    const tokens = estimateTokens(raw)
    remaining = Math.max(0, remaining - tokens)
    if (fittedBody.trimmed) trimmedLayers.push('recent_body')
    layers.push({
      key: 'recent_body',
      label: '当前章节正文',
      tokens,
      budgetTokens: remaining + tokens,
      trimmed: fittedBody.trimmed,
      itemCount: 1,
      preview: raw,
    })
  }

  const totalTokens = layers.reduce((sum, l) => sum + l.tokens, 0)
  const contextText = layers.map((l) => l.preview).join('\n\n')

  return {
    contextText,
    totalTokens,
    budgetTokens,
    trimmedLayers,
    referencedCodexIds: referencedIds,
    missingCodexIds,
    layers,
    preflight: {
      status: warnings.length > 0 ? 'attention' : 'ready',
      warnings,
    },
  }
}

export interface ReferencedItemInput {
  type: 'chapter' | 'outline' | 'character' | 'worldview' | 'item'
  id: string
  title?: string
}

/**
 * 解析用户在 AI 助手中通过 @ 显式引用的一个或多个文件/设定，
 * 装配完整内容用于 AI 深度分析或解读。
 */
export async function resolveReferencedContext(
  novelId: string,
  items: ReferencedItemInput[],
  budgetTokens = 24000
): Promise<string> {
  if (!novelId || !Array.isArray(items) || items.length === 0) return ''

  const chapterIds = items.filter((i) => i.type === 'chapter').map((i) => i.id)
  const characterIds = items.filter((i) => i.type === 'character').map((i) => i.id)
  const worldviewIds = items.filter((i) => i.type === 'worldview').map((i) => i.id)
  const itemIds = items.filter((i) => i.type === 'item').map((i) => i.id)
  const includeOutline = items.some((i) => i.type === 'outline')

  const [novel, chapters, characters, worldviews, codexItems] = await Promise.all([
    includeOutline
      ? db.novel.findUnique({
          where: { id: novelId },
          select: { title: true, genre: true, synopsis: true, outline: true },
        })
      : Promise.resolve(null),
    chapterIds.length > 0
      ? db.chapter.findMany({
          where: { id: { in: chapterIds }, novelId },
          select: { id: true, title: true, summary: true, content: true, words: true },
        })
      : Promise.resolve([] as Array<{ id: string; title: string; summary: string | null; content: string; words: number }>),
    characterIds.length > 0
      ? db.character.findMany({
          where: { id: { in: characterIds }, novelId },
        })
      : Promise.resolve([]),
    worldviewIds.length > 0
      ? db.worldview.findMany({
          where: { id: { in: worldviewIds }, novelId },
        })
      : Promise.resolve([]),
    itemIds.length > 0
      ? db.item.findMany({
          where: { id: { in: itemIds }, novelId },
        })
      : Promise.resolve([]),
  ])

  const sections: string[] = []

  if (novel) {
    sections.push(
      `[引用文件：全书大纲与简介]\n书名：${novel.title}（${novel.genre}）\n简介：${novel.synopsis || '（未填写）'}\n大纲：${novel.outline || '（未填写）'}`
    )
  }

  const chapterMap = new Map(chapters.map((c) => [c.id, c]))
  for (const id of chapterIds) {
    const ch = chapterMap.get(id)
    if (!ch) continue
    const plain = stripHtml(ch.content || '')
    sections.push(
      `[引用章节：${ch.title}（${ch.words}字）]\n摘要：${ch.summary || '（无）'}\n正文内容：\n${plain || '（暂无正文内容）'}`
    )
  }

  for (const c of characters) {
    sections.push(
      `[引用角色：${c.name}]\n外貌：${c.appearance || '未知'}\n性格：${c.personality || '未知'}\n背景：${c.background || '未知'}\n能力/功法：${c.abilities || '无'}\n关系：${c.relations || '无'}`
    )
  }

  for (const w of worldviews) {
    sections.push(
      `[引用世界观/${w.type}：${w.name}]\n描述：${w.description || '无'}`
    )
  }

  for (const it of codexItems) {
    sections.push(
      `[引用道具/功法(${it.type})：${it.name}]\n属性：${it.attributes || '无'}\n效果：${it.effect || '无'}`
    )
  }

  if (sections.length === 0) return ''

  const combined = `【用户 @ 引用的指定文件与设定（请重点基于以下材料进行分析、解读或回答）】\n\n${sections.join('\n\n---\n\n')}`
  return fitToBudget(combined, budgetTokens).text
}
