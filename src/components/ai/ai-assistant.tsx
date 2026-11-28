'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Send,
  Square,
  SlidersHorizontal,
  Sparkles,
  Loader2,
  Wand2,
  BookMarked,
  Trash2,
  Bot,
  User as UserIcon,
  Lightbulb,
  AtSign,
  FileText,
  BookText,
  Users,
  Globe,
  Gem,
  X,
  Cpu,
  Copy,
  Check,
  List,
  Plus,
  RefreshCw,
  Feather,
  Tag,
  Pencil,
  History,
  GitBranch,
  ArrowDownToLine,
} from 'lucide-react'
import { api, countWords, stripHtml } from '@/lib/helpers'
import { allowsAiProseWriteback, CONTINUATION_CONTEXT_LENGTH, MAX_CHAPTER_DRAFT_LENGTH } from '@/lib/ai-writing-intent'
import { getStoredSkillIds, saveStoredSkillIds, WRITING_SKILLS } from '@/lib/writing-skills'
import { getSavedPrompts, SAVED_PROMPTS_EVENT, type SavedPromptItem } from '@/lib/saved-prompts'
import { toast } from 'sonner'
import { hasProAiAccess, PLATFORM_MODEL_ALIASES, type PublicAiModel } from '@/lib/ai-models'
import type { AiReferenceOption } from '@/app/api/ai/references/route'
import { MarkdownRenderer, markdownToPlainText } from './markdown-renderer'
import { WritingStyleDialog, type WritingStyleItem } from './writing-style-dialog'
import { DeepChapterDialog } from '@/components/editor/multi-agent-studio'
import { Checkbox } from '@/components/ui/checkbox'

const DAILY_TASKS = [
  {
    id: 'chapter_gen',
    label: '写初稿',
    description: '填写本章要发生的核心事件，直接生成一篇完整初稿。生成后先预览，再确认写入当前章节。',
  },
  {
    id: 'continue',
    label: '续写',
    description: '读取当前章节末尾并接着往下写，只生成新增内容，适合正文还没写完时使用。',
    instruction: '接续当前章的末尾，直接输出新增正文。',
  },
  {
    id: 'polish',
    label: '润色',
    description: '保留当前章节的剧情和人物，只调整表达、节奏与流畅度。生成后可预览并替换整章。',
    instruction: '润色当前章节的完整正文，保留剧情、人物和细节，直接输出润色后的完整正文。',
  },
  {
    id: 'editor_review',
    label: '审稿',
    description: '只检查当前章节的节奏、人物、冲突和逻辑问题，给出建议，不会改写或写入正文。',
    instruction: '审稿当前章节，指出影响节奏、人物口吻和追读的具体问题，并给出改法。',
  },
] as const

interface ChapterReplacement {
  chapterId: string
  original: string
  text: string
}

interface Preset {
  id: string
  name: string
  category: string
  description: string
}

type PendingPreset = Pick<Preset, 'id' | 'name' | 'description'> & { targetChapterId?: string }

interface ReferencedItem {
  type: AiReferenceOption['type']
  id: string
  title: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  preset?: string
  modelLabel?: string
  references?: ReferencedItem[]
  isError?: boolean
  chapterId?: string | null
  usesChapterDraft?: boolean
  appliedSkills?: string[]
}

interface PromptTag {
  id: string
  label: string
  prompt: string
  builtin?: boolean
}

const BUILTIN_PROMPT_TAGS: PromptTag[] = [
  {
    id: 'explain_changes',
    label: '简要说明修改点',
    prompt:
      '请在所有修改内容输出的最后，单独用 `## 修改说明` 作为标题，用 3-5 条简短要点概括本次主要修改了哪些地方（如删掉了哪些 AI 套话、调整了哪段节奏或对话）。',
    builtin: true,
  },
  {
    id: 'keep_plot',
    label: '保留原剧情与人设',
    prompt: '严格保留原有剧情事件顺序与人物设定，只优化文风、句式和语言质感，不要擅自增删关键情节。',
    builtin: true,
  },
  {
    id: 'more_action',
    label: '增强画面与动作感',
    prompt: '减少抽象心理总结与说教句，多用具体动作、眼神与环境细节推进场景。',
    builtin: true,
  },
  {
    id: 'semantic_audit',
    label: '语义终审（去AI味兜底）',
    prompt:
      '【语义终审】以下自检不看任何禁词表，只凭语感判断：1. 逐段自问这句话是不是只有 AI 会这么写——判断依据是句子的功能，不是词：这句在报账情绪吗？在替作者解释吗？在给普通事贴标签吗？是在换说法复读上一句吗？2. 挑出读起来「太顺、太齐、太懂事」的三处（句式太规整、语气太中立、反应太得体），各改一处：打断它、说半截、让它失态。3. 检查有没有为了「像人」而硬加的毛边（硬塞的语气词、硬凑的琐碎细节），有就删掉——刻意的不完美也是 AI 味。4. 剧情事实、数字与人物称呼一个字不动。不要输出自检过程。',
    builtin: true,
  },
  {
    id: 'deai_rewrite_rules',
    label: '去AI味改写规则（对话修改用）',
    prompt:
      '【去AI味改写规则】本次修改必须遵守：1. 情绪不报账：删掉直接命名情绪的句子（心中一紧、感到一阵寒意），改成动作、身体反应或现场声响；删掉的位置不要造比喻顶上。2. 打散模板感：不连续三句长度接近；删三连排比与对仗；删只承上启下的过渡句（与此同时、就这样）；同一角色受挫时的身体反应不要复读同一套（同一个人「抖」了五回那种）。3. 冲突解法不能靠现场冒出的新规则/新批注，关键规则生效前至少埋一次线索。4. 弹幕、围观人群不替读者总结或夸主角，只写具体行为。5. 环境三问：行动条件/可交互物件/生理感受，三样都不沾就删；比喻分两级——带具体信息的保留（像谁把生锈的针管泡在福尔马林里），空装饰类比（X般的Y）删。6. 禁语，改后文本不得出现：不禁、仿佛、宛如、一抹、深吸一口气、嘴角微微上扬、眼神微眯、眼底闪过、命运的齿轮、空气仿佛凝固、心中五味杂陈、下意识。7. 只改病灶句，其余内容逐字保留；剧情事实、规则条目、数字、人物称呼一个字不动。',
    builtin: true,
  },
]

interface MarketPromptItem {
  id: string
  title: string
  category: string
  description: string
  promptText: string
}

interface AiActionHistoryItem {
  id: string
  kind: 'reply' | 'replace'
  title: string
  preview: string
  fullText: string
  words: number
  createdAt: string
  allowWriteback?: boolean
  chapterId?: string | null
}

interface ChapterBrief {
  id: string
  title: string
  words: number
}

interface ParsedChapterSection {
  chapterId: string
  title: string
  rawMarkdown: string
  content: string
  prevWords: number
  nextWords: number
}

function plainToChapterHtml(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
    .filter(Boolean)
  if (lines.length === 0) return '<p></p>'
  return lines
    .map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

function normalizeChapterHeading(raw: string): string {
  return raw
    .replace(/^#+\s*/, '')
    .replace(/^[【\[]|[】\]]$/g, '')
    .replace(/[：:]/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function parseCnOrArabicNum(raw: string): number | null {
  const m = raw.match(/第([一二三四五六七八九十百千万零〇0-9]+)[章节回]/)
  if (!m) return null
  const token = m[1]
  if (/^\d+$/.test(token)) return parseInt(token, 10)
  const map: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  const unitMap: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let num = 0
  for (const ch of token) {
    if (map[ch] !== undefined) {
      num = map[ch]
    } else if (unitMap[ch]) {
      const unit = unitMap[ch]
      if (unit === 10000) {
        section = (section + num) * 10000
        total += section
        section = 0
      } else {
        section += (num === 0 && unit === 10 ? 1 : num) * unit
      }
      num = 0
    }
  }
  return total + section + num
}

function parseMultiChapterSections(
  content: string,
  messageRefs: ReferencedItem[] | undefined,
  allChapters: ChapterBrief[]
): { preamble: string; sections: ParsedChapterSection[]; postscript: string } {
  const refChapterIds = new Set(
    (messageRefs || []).filter((r) => r.type === 'chapter').map((r) => r.id)
  )
  const candidates = allChapters.filter((chapter) => refChapterIds.has(chapter.id))

  if (candidates.length < 2 || !content?.trim()) {
    return { preamble: '', sections: [], postscript: '' }
  }

  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const preambleLines: string[] = []
  const postscriptLines: string[] = []
  const matched: Array<{ chapter: ChapterBrief; lines: string[] }> = []
  let current: { chapter: ChapterBrief; lines: string[] } | null = null
  let inPostscript = false

  const findMatchingChapter = (line: string): ChapterBrief | null => {
    const trimmed = line.trim()
    const isHeading =
      /^#{1,4}\s+/.test(trimmed) ||
      /^【.+】$/.test(trimmed) ||
      /^第[一二三四五六七八九十百千万0-9]+[章节回]/.test(trimmed)
    if (!isHeading) return null
    const normLine = normalizeChapterHeading(trimmed)
    if (!normLine) return null
    for (const ch of candidates) {
      const normTitle = normalizeChapterHeading(ch.title)
      if (!normTitle) continue
      if (normLine === normTitle || normLine.includes(normTitle) || normTitle.includes(normLine)) {
        return ch
      }
      const chNum = parseCnOrArabicNum(ch.title)
      const lineNum = parseCnOrArabicNum(trimmed)
      if (chNum !== null && lineNum !== null && chNum === lineNum) {
        return ch
      }
    }
    return null
  }

  for (const line of lines) {
    const hit = findMatchingChapter(line)
    if (hit) {
      inPostscript = false
      current = { chapter: hit, lines: [] }
      matched.push(current)
    } else if (
      current &&
      /^(?:#{1,3}\s*[^\n]*(?:说明|摘要|总结|提示|建议|分析|衔接)|【[^\n】]{1,12}(?:说明|提示|摘要|总结|建议|分析|确认)】)/.test(line.trim())
    ) {
      inPostscript = true
      postscriptLines.push(line)
    } else if (inPostscript) {
      postscriptLines.push(line)
    } else if (current) {
      current.lines.push(line)
    } else {
      preambleLines.push(line)
    }
  }

  const deduped = new Map<string, ParsedChapterSection>()
  for (const item of matched) {
    const rawMd = item.lines.join('\n').trim()
    const plain = markdownToPlainText(rawMd).trim()
    const nextWords = countWords(plain)
    deduped.set(item.chapter.id, {
      chapterId: item.chapter.id,
      title: item.chapter.title,
      rawMarkdown: rawMd,
      content: plain,
      prevWords: item.chapter.words || 0,
      nextWords,
    })
  }

  return {
    preamble: preambleLines.join('\n').trim(),
    sections: Array.from(deduped.values()),
    postscript: postscriptLines.join('\n').trim(),
  }
}

function splitSingleChapterAndNotes(content: string): {
  leadingNote: string
  chapterTitle: string | null
  bodyMarkdown: string
  trailingNote: string
} {
  if (!content?.trim()) {
    return { leadingNote: '', chapterTitle: null, bodyMarkdown: '', trailingNote: '' }
  }

  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const chapterHeadingRe = /^#{1,4}\s*(第[一二三四五六七八九十百千万0-9]+[章节回][^\n]*)$|^(第[一二三四五六七八九十百千万0-9]+[章节回](?:\s+[^\n]+)?)$/
  const leadingNoteStartRe = /^(【待作者确认】|〔待作者确认〕|【说明】|【创作说明】|注：|说明：)/
  const trailingNoteStartRe = /^(?:#{1,3}\s*[^\n]*(?:说明|摘要|总结|提示|建议|分析|衔接|确认)|【[^\n】]{1,12}(?:说明|提示|摘要|总结|建议|分析|确认)】|〔待作者确认〕)/

  let chapterIdx = -1
  let chapterTitle: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const m = trimmed.match(chapterHeadingRe)
    if (m) {
      chapterIdx = i
      chapterTitle = (m[1] || m[2] || '').trim()
      break
    }
  }

  let leadingEnd = 0
  if (chapterIdx > 0) {
    leadingEnd = chapterIdx
  } else if (chapterIdx === -1 && leadingNoteStartRe.test(lines[0].trim())) {
    const sepIdx = lines.findIndex((l, idx) => idx > 0 && /^---+$/.test(l.trim()))
    if (sepIdx > 0) {
      leadingEnd = sepIdx + 1
    } else {
      const blankIdx = lines.findIndex((l, idx) => idx > 0 && l.trim() === '')
      if (blankIdx > 0 && blankIdx < lines.length - 1) {
        leadingEnd = blankIdx + 1
      }
    }
  }

  const leadingNote = lines
    .slice(0, leadingEnd)
    .filter((l) => !/^---+$/.test(l.trim()))
    .join('\n')
    .trim()

  const bodyStart = chapterIdx >= 0 ? chapterIdx + 1 : leadingEnd
  let trailingStart = lines.length
  for (let i = bodyStart; i < lines.length; i++) {
    if (trailingNoteStartRe.test(lines[i].trim())) {
      trailingStart = i
      if (i > bodyStart && /^---+$/.test(lines[i - 1].trim())) {
        trailingStart = i - 1
      }
      break
    }
  }

  const bodyMarkdown = lines
    .slice(bodyStart, trailingStart)
    .join('\n')
    .replace(/^(?:\s*---+\s*\n)+/, '')
    .trim()

  const trailingNote = lines
    .slice(trailingStart)
    .filter((l) => !/^---+$/.test(l.trim()))
    .join('\n')
    .trim()

  if (!bodyMarkdown) {
    return { leadingNote: '', chapterTitle: null, bodyMarkdown: content, trailingNote: '' }
  }

  return { leadingNote, chapterTitle, bodyMarkdown, trailingNote }
}

interface Props {
  novelId: string
  chapterId: string | null
  chapterContent: string
  writingStyleId?: string | null
  chapters?: ChapterBrief[]
  onWritingStyleChange?: (styleId: string | null) => void
  onChaptersUpdated?: () => void
  onApplyChapterText: (action: 'append' | 'replace', text: string, targetChapterId: string, original?: string) => boolean
}

const REF_TYPE_META: Record<
  AiReferenceOption['type'],
  { label: string; icon: typeof FileText; chipClass: string }
> = {
  chapter: {
    label: '章节',
    icon: FileText,
    chipClass: 'bg-primary/10 text-primary border-primary/20',
  },
  outline: {
    label: '大纲',
    icon: BookText,
    chipClass: 'bg-gold/10 text-gold border-gold/20',
  },
  character: {
    label: '角色',
    icon: Users,
    chipClass: 'bg-jade/10 text-jade border-jade/20',
  },
  worldview: {
    label: '世界观',
    icon: Globe,
    chipClass: 'bg-primary/10 text-primary border-primary/20',
  },
  item: {
    label: '道具',
    icon: Gem,
    chipClass: 'bg-cinnabar/10 text-cinnabar border-cinnabar/20',
  },
}

type ChapterDiffCharSeg = { text: string; changed: boolean }

type ChapterDiffRow = {
  status: 'same' | 'removed' | 'added' | 'changed'
  left?: string
  right?: string
  leftSegs?: ChapterDiffCharSeg[]
  rightSegs?: ChapterDiffCharSeg[]
}

const CHAPTER_SENTENCE_END_RE = /[。！？!?…；;”’"』」～~〕）)】]$/

// 对比前统一格式：去掉首尾空格/缩进，把被硬换行拆断的句子合并回完整段落
function normalizeChapterParagraphs(raw: string): string[] {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[ \t\u3000]+/, '').replace(/[ \t\u3000]+$/, ''))
    .filter((line) => line.length > 0)
  const paragraphs: string[] = []
  let buffer = ''
  for (const line of lines) {
    buffer += line
    if (CHAPTER_SENTENCE_END_RE.test(line)) {
      paragraphs.push(buffer)
      buffer = ''
    }
  }
  if (buffer) paragraphs.push(buffer)
  return paragraphs
}

// 比较键：忽略所有空白字符，避免空格/换行差异造成误判
function chapterParagraphKey(para: string): string {
  return para.replace(/[\s\u3000]+/g, '')
}

function splitParagraphsForDiff(text: string): string[] {
  return normalizeChapterParagraphs(text)
}

// 字符级 diff：找出两段文字中真正变化的字符
function diffChapterChars(a: string, b: string): { left: ChapterDiffCharSeg[]; right: ChapterDiffCharSeg[] } {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || n * m > 1_000_000) {
    return { left: [{ text: a, changed: true }], right: [{ text: b, changed: true }] }
  }
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }
  const pushSeg = (arr: ChapterDiffCharSeg[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1]
    if (last && last.changed === changed) last.text += text
    else arr.push({ text, changed })
  }
  const left: ChapterDiffCharSeg[] = []
  const right: ChapterDiffCharSeg[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushSeg(left, a[i], false)
      pushSeg(right, b[j], false)
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      pushSeg(left, a[i], true)
      i++
    } else {
      pushSeg(right, b[j], true)
      j++
    }
  }
  while (i < n) {
    pushSeg(left, a[i], true)
    i++
  }
  while (j < m) {
    pushSeg(right, b[j], true)
    j++
  }
  return { left, right }
}

function diffChapterParagraphs(a: string[], b: string[]): ChapterDiffRow[] {
  const n = a.length
  const m = b.length
  const keysA = a.map(chapterParagraphKey)
  const keysB = b.map(chapterParagraphKey)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = keysA[i] === keysB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: ChapterDiffRow[] = []
  let pendingR: string[] = []
  let pendingA: string[] = []
  // 相邻的删除段/新增段两两配对成「修改行」，做段内字符级 diff
  const flushPending = () => {
    const k = Math.min(pendingR.length, pendingA.length)
    for (let t = 0; t < k; t++) {
      const l = pendingR[t]
      const r = pendingA[t]
      const segs = diffChapterChars(l, r)
      rows.push({ status: 'changed', left: l, right: r, leftSegs: segs.left, rightSegs: segs.right })
    }
    for (let t = k; t < pendingR.length; t++) rows.push({ status: 'removed', left: pendingR[t] })
    for (let t = k; t < pendingA.length; t++) rows.push({ status: 'added', right: pendingA[t] })
    pendingR = []
    pendingA = []
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (keysA[i] === keysB[j]) {
      flushPending()
      rows.push({ status: 'same', left: a[i], right: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pendingR.push(a[i])
      i++
    } else {
      pendingA.push(b[j])
      j++
    }
  }
  while (i < n) {
    pendingR.push(a[i])
    i++
  }
  while (j < m) {
    pendingA.push(b[j])
    j++
  }
  flushPending()
  return rows
}

function ChapterDiffCell({ side, row }: { side: 'old' | 'new'; row: ChapterDiffRow }) {
  const isOld = side === 'old'
  const text = isOld ? row.left : row.right
  const isDiff = row.status !== 'same'
  const diffClass = isOld
    ? 'border-l-2 border-red-400 bg-red-500/10'
    : 'border-l-2 border-emerald-400 bg-emerald-500/10'
  if (text == null) {
    return (
      <div className="h-full rounded-md border-l-2 border-dashed border-muted-foreground/30 bg-muted/20 px-2 py-1">
        <p className="select-none text-[13px] italic tracking-normal text-muted-foreground/60">
          （{isOld ? '此段已删除' : '此段为新增'}）
        </p>
      </div>
    )
  }
  const segs = isOld ? row.leftSegs : row.rightSegs
  return (
    <div className={`h-full rounded-md px-2 py-1 indent-[2em] ${isDiff ? diffClass : ''}`}>
      {row.status === 'changed' && segs
        ? segs.map((seg, segIndex) => (
            <span
              key={segIndex}
              className={
                seg.changed
                  ? isOld
                    ? 'rounded-[2px] bg-red-400/50 text-red-950'
                    : 'rounded-[2px] bg-emerald-400/50 text-emerald-950'
                  : undefined
              }
            >
              {seg.text}
            </span>
          ))
        : text}
    </div>
  )
}

function ChapterReplacementDiffPreview({ original, next }: { original: string; next: string }) {
  const rows = useMemo(
    () => diffChapterParagraphs(splitParagraphsForDiff(original), splitParagraphsForDiff(next)),
    [original, next]
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [markers, setMarkers] = useState<{ top: number; height: number }[]>([])

  // 差异行位置标记（滚动条色条）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const raw: { top: number; height: number }[] = []
    el.querySelectorAll<HTMLElement>('[data-diff-row="1"]').forEach((node) => {
      raw.push({
        top: (node.offsetTop / el.scrollHeight) * 100,
        height: Math.max((node.offsetHeight / el.scrollHeight) * 100, 0.8),
      })
    })
    const merged: { top: number; height: number }[] = []
    for (const seg of raw) {
      const prev = merged[merged.length - 1]
      if (prev && seg.top <= prev.top + prev.height + 0.5) {
        prev.height = Math.max(prev.height, seg.top + seg.height - prev.top)
      } else {
        merged.push({ ...seg })
      }
    }
    setMarkers(merged)
  }, [rows])

  return (
    <div className="min-w-0 rounded-md border p-4">
      <div className="mb-2 grid grid-cols-2 gap-x-3">
        <p className="font-medium">现有正文</p>
        <p className="font-medium">待写入正文</p>
      </div>
      <div className="relative">
        <div
          ref={scrollRef}
          className="relative max-h-[56dvh] overflow-y-auto break-words pr-3 text-[16px] leading-[1.95] tracking-[0.015em] text-foreground"
        >
          {rows.length === 0 && <p className="text-sm text-muted-foreground">暂无正文</p>}
          {rows.map((row, index) => (
            <div
              key={index}
              data-diff-row={row.status !== 'same' ? '1' : undefined}
              className={`grid grid-cols-2 gap-x-3 ${index > 0 ? 'mt-[1.05em]' : ''}`}
            >
              <ChapterDiffCell side="old" row={row} />
              <ChapterDiffCell side="new" row={row} />
            </div>
          ))}
        </div>
        {markers.length > 0 && (
          <div aria-hidden className="pointer-events-none absolute right-0 top-0 h-full w-1.5 rounded-full bg-muted/60">
            {markers.map((seg, index) => (
              <span
                key={index}
                className="absolute right-0 w-full rounded-full bg-amber-500/80"
                style={{ top: `${Math.min(seg.top, 100 - seg.height)}%`, height: `${seg.height}%` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function AiAssistant({
  novelId,
  chapterId,
  chapterContent,
  writingStyleId,
  chapters = [],
  onWritingStyleChange,
  onChaptersUpdated,
  onApplyChapterText,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetOpen, setPresetOpen] = useState(false)
  const [pendingPreset, setPendingPreset] = useState<PendingPreset | null>(null)
  const [presetPromptInput, setPresetPromptInput] = useState('')
  const [replacement, setReplacement] = useState<ChapterReplacement | null>(null)
  const [deepChapter, setDeepChapter] = useState<{ chapterId: string; goal: string } | null>(null)
  // 分支讨论窗口（类似 ChatGPT Branch：引用消息到独立窗口讨论，完成后合并回主会话）
  const [branchSeed, setBranchSeed] = useState<string | null>(null)
  const [branchMessages, setBranchMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [branchInput, setBranchInput] = useState('')
  const [branchLoading, setBranchLoading] = useState(false)
  const [activeSkillIds, setActiveSkillIds] = useState<string[] | undefined>()

  useEffect(() => {
    const syncSkills = () => setActiveSkillIds(getStoredSkillIds(novelId))
    syncSkills()
    window.addEventListener('storage', syncSkills)
    return () => window.removeEventListener('storage', syncSkills)
  }, [novelId])

  const updateSkills = (ids: string[] | undefined) => {
    setActiveSkillIds(ids)
    saveStoredSkillIds(novelId, ids)
  }

  // 模型选择（仅展示自定义脱敏名称，如 baogeng_v4 / baogeng_v4_pro）
  const [models, setModels] = useState<(PublicAiModel & { locked?: boolean })[]>(PLATFORM_MODEL_ALIASES)
  const [selectedModel, setSelectedModel] = useState<string>('baogeng_v4')
  const [userPlan, setUserPlan] = useState<string>('free')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  // 个人写作风格
  const [writingStyles, setWritingStyles] = useState<WritingStyleItem[]>([])
  const [activeStyleId, setActiveStyleId] = useState<string | null>(writingStyleId ?? null)
  const [styleDialogOpen, setStyleDialogOpen] = useState(false)
  const [appliedChapters, setAppliedChapters] = useState<Record<number, string[]>>({})
  const [applyingKey, setApplyingKey] = useState<string | null>(null)
  const [actionHistory, setActionHistory] = useState<AiActionHistoryItem[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'replace' | 'reply'>('all')
  const historyHydratedRef = useRef<string | null>(null)

  // 附加提示词标签
  const [promptTags, setPromptTags] = useState<PromptTag[]>(BUILTIN_PROMPT_TAGS)
  const [activeTagIds, setActiveTagIds] = useState<string[]>([])
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [newTagLabel, setNewTagLabel] = useState('')
  const [newTagPrompt, setNewTagPrompt] = useState('')
  const [marketPrompts, setMarketPrompts] = useState<SavedPromptItem[]>([])

  // @ 多文件引用状态
  const [availableRefs, setAvailableRefs] = useState<AiReferenceOption[]>([])
  const [referencedItems, setReferencedItems] = useState<ReferencedItem[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionTriggerType, setMentionTriggerType] = useState<'at' | 'button'>('button')

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const lastRequestRef = useRef<{ text: string; preset?: string; refs?: ReferencedItem[]; chapterId: string | null; usesChapterDraft: boolean } | null>(null)
  const currentChapterTitle = chapters.find((chapter) => chapter.id === chapterId)?.title

  const previewReplacement = (text: string, targetChapterId: string, original = chapterContent) => {
    if (targetChapterId !== chapterId || original !== chapterContent) {
      toast.error('原章节已切换或正文已更新，请回到原章重新生成。')
      return false
    }
    const body = markdownToPlainText(splitSingleChapterAndNotes(text).bodyMarkdown).trim()
    if (!body) return false
    setReplacement({ chapterId: targetChapterId, original, text: body })
    return true
  }

  useEffect(() => {
    api<{ presets: Preset[] }>('/api/ai?scope=assistant')
      .then((r) => setPresets(r.presets))
      .catch(() => { })

    api<{ models: (PublicAiModel & { locked?: boolean })[]; userPlan?: string }>('/api/ai/models')
      .then((r) => {
        if (r.userPlan) setUserPlan(r.userPlan)
        if (r.models?.length) {
          setModels(r.models)
          const unlocked = r.models.filter((m) => !m.locked)
          const def = unlocked.find((m) => m.isDefault) || unlocked[0] || r.models[0]
          if (def) setSelectedModel(def.id)
        }
      })
      .catch(() => { })
  }, [])

  const loadWritingStyles = useCallback(async () => {
    try {
      const res = await api<{ styles: WritingStyleItem[] }>('/api/writing-styles')
      setWritingStyles(res.styles || [])
    } catch { }
  }, [])

  useEffect(() => {
    void loadWritingStyles()
    const onUpdated = () => void loadWritingStyles()
    window.addEventListener('moling:writing-styles-updated', onUpdated)
    return () => window.removeEventListener('moling:writing-styles-updated', onUpdated)
  }, [loadWritingStyles])

  useEffect(() => {
    try {
      const savedV2 = localStorage.getItem('moling_ai_prompt_tags_v2')
      if (savedV2) {
        const parsed = JSON.parse(savedV2)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 内置标签始终保留（代码新增的内置标签能出现在面板上）；
          // 用户改过的内置标签以本地缓存为准；自定义标签从缓存恢复
          const merged = [
            ...BUILTIN_PROMPT_TAGS.map((b) => parsed.find((t: PromptTag) => t.id === b.id) || b),
            ...parsed.filter((t: PromptTag) => !t.builtin),
          ]
          setPromptTags(merged)
        }
      } else {
        const legacy = localStorage.getItem('moling_ai_prompt_tags')
        if (legacy) {
          const parsedLegacy = JSON.parse(legacy)
          if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
            setPromptTags([...BUILTIN_PROMPT_TAGS, ...parsedLegacy])
          }
        }
      }
      const savedActive = localStorage.getItem('moling_ai_active_tags')
      if (savedActive) setActiveTagIds(JSON.parse(savedActive))
    } catch { }
    const syncSaved = () => setMarketPrompts(getSavedPrompts())
    syncSaved()
    window.addEventListener(SAVED_PROMPTS_EVENT, syncSaved)
    return () => window.removeEventListener(SAVED_PROMPTS_EVENT, syncSaved)
  }, [])

  const allPromptTags = promptTags

  const persistPromptTags = (nextTags: PromptTag[], nextActive?: string[]) => {
    setPromptTags(nextTags)
    try {
      localStorage.setItem('moling_ai_prompt_tags_v2', JSON.stringify(nextTags))
      if (nextActive !== undefined) {
        localStorage.setItem('moling_ai_active_tags', JSON.stringify(nextActive))
      }
    } catch { }
  }

  const togglePromptTag = (id: string) => {
    setActiveTagIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem('moling_ai_active_tags', JSON.stringify(next))
      } catch { }
      return next
    })
  }

  const startEditTag = (tag: PromptTag) => {
    setEditingTagId(tag.id)
    setNewTagLabel(tag.label)
    setNewTagPrompt(tag.prompt)
    setTagPopoverOpen(true)
  }

  const resetTagForm = () => {
    setEditingTagId(null)
    setNewTagLabel('')
    setNewTagPrompt('')
  }

  const handleSavePromptTag = () => {
    if (!newTagLabel.trim() || !newTagPrompt.trim()) {
      toast.error('请填写标签名称和提示词说明')
      return
    }
    const label = newTagLabel.trim().slice(0, 20)
    const prompt = newTagPrompt.trim().slice(0, 500)

    if (editingTagId) {
      const nextTags = promptTags.map((t) =>
        t.id === editingTagId ? { ...t, label, prompt } : t
      )
      persistPromptTags(nextTags)
      toast.success(`已更新标签「${label}」`)
      resetTagForm()
      return
    }

    const created: PromptTag = {
      id: `tag_${Date.now()}`,
      label,
      prompt,
    }
    const nextTags = [...promptTags, created]
    const nextActive = [...activeTagIds, created.id]
    setActiveTagIds(nextActive)
    persistPromptTags(nextTags, nextActive)
    resetTagForm()
    toast.success(`已添加并启用标签「${created.label}」`)
  }

  const handleDeletePromptTag = (id: string) => {
    const nextTags = promptTags.filter((t) => t.id !== id)
    const nextActive = activeTagIds.filter((x) => x !== id)
    setActiveTagIds(nextActive)
    persistPromptTags(nextTags, nextActive)
    if (editingTagId === id) resetTagForm()
  }

  useEffect(() => {
    if (writingStyleId !== undefined) {
      setActiveStyleId(writingStyleId)
    }
  }, [writingStyleId])

  useEffect(() => {
    if (!novelId || writingStyleId !== undefined) return
    api<{ novel?: { writingStyleId?: string | null } }>(`/api/novels?id=${novelId}`)
      .then((r) => {
        setActiveStyleId(r.novel?.writingStyleId || null)
      })
      .catch(() => { })
  }, [novelId, writingStyleId])

  const handleBindStyle = async (styleId: string | null) => {
    setActiveStyleId(styleId)
    onWritingStyleChange?.(styleId)
    if (!novelId) return
    try {
      await api('/api/novels', {
        method: 'PATCH',
        body: JSON.stringify({ id: novelId, writingStyleId: styleId }),
      })
    } catch { }
  }

  useEffect(() => {
    if (!novelId) return
    historyHydratedRef.current = null
    try {
      const savedMsgs = localStorage.getItem(`moling_ai_chat_history_${novelId}`)
      if (savedMsgs) {
        const parsed = JSON.parse(savedMsgs)
        if (Array.isArray(parsed)) setMessages(parsed)
      } else {
        setMessages([])
      }
      const savedActions = localStorage.getItem(`moling_ai_action_history_${novelId}`)
      if (savedActions) {
        const parsed = JSON.parse(savedActions)
        if (Array.isArray(parsed)) setActionHistory(parsed)
      } else {
        setActionHistory([])
      }
    } catch { }
    historyHydratedRef.current = novelId
  }, [novelId])

  useEffect(() => {
    if (!novelId || loading || historyHydratedRef.current !== novelId) return
    try {
      const cleanMsgs = messages.filter((m) => m.content?.trim()).slice(-40)
      localStorage.setItem(`moling_ai_chat_history_${novelId}`, JSON.stringify(cleanMsgs))
    } catch { }
  }, [messages, novelId, loading])

  const appendActionHistory = useCallback(
    (entry: Omit<AiActionHistoryItem, 'id' | 'createdAt'>) => {
      if (!novelId) return
      const item: AiActionHistoryItem = {
        ...entry,
        id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      }
      setActionHistory((prev) => {
        const next = [item, ...prev].slice(0, 50)
        try {
          localStorage.setItem(`moling_ai_action_history_${novelId}`, JSON.stringify(next))
        } catch { }
        return next
      })
    },
    [novelId]
  )

  const canWriteReply = (messageIndex: number) => {
    for (let index = messageIndex - 1; index >= 0; index--) {
      const request = messages[index]
      if (request.role === 'user') return allowsAiProseWriteback(request.content, request.preset)
    }
    return false
  }

  const handleApplyChapterSections = async (msgIdx: number, sections: ParsedChapterSection[]) => {
    const targetIds = new Set(messages[msgIdx]?.references?.filter((ref) => ref.type === 'chapter').map((ref) => ref.id))
    if (messages[msgIdx]?.usesChapterDraft || !canWriteReply(msgIdx) ||
        sections.length === 0 || sections.some((section) => !targetIds.has(section.chapterId))) return
    const key = sections.length === 1 ? `${msgIdx}-${sections[0].chapterId}` : `${msgIdx}-all`
    setApplyingKey(key)
    try {
      const summaryParts: string[] = []
      for (const sec of sections) {
        const html = plainToChapterHtml(sec.content)
        await api('/api/chapters', {
          method: 'PATCH',
          body: JSON.stringify({
            id: sec.chapterId,
            content: html,
            words: sec.nextWords,
          }),
        })
        const delta = sec.nextWords - sec.prevWords
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`
        summaryParts.push(`${sec.title}(${deltaStr}字)`)
        appendActionHistory({
          kind: 'replace',
          allowWriteback: true,
          title: `写入「${sec.title}」(${deltaStr}字)`,
          preview: sec.content.slice(0, 100),
          fullText: sec.content,
          words: sec.nextWords,
          chapterId: sec.chapterId,
        })
      }
      setAppliedChapters((prev) => ({
        ...prev,
        [msgIdx]: Array.from(new Set([...(prev[msgIdx] || []), ...sections.map((s) => s.chapterId)])),
      }))
      onChaptersUpdated?.()
      toast.success(`已写回 ${sections.length} 章：${summaryParts.join('、')}`)
    } catch (e: any) {
      toast.error(e.message || '写回章节失败')
    } finally {
      setApplyingKey(null)
    }
  }

  const loadReferences = useCallback(() => {
    if (!novelId) return
    api<{ references: AiReferenceOption[] }>(`/api/ai/references?novelId=${novelId}`)
      .then((r) => setAvailableRefs(r.references || []))
      .catch(() => { })
  }, [novelId])

  useEffect(() => {
    loadReferences()
  }, [loadReferences])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const filteredRefs = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    const list = q
      ? availableRefs.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.subtitle && r.subtitle.toLowerCase().includes(q)) ||
          REF_TYPE_META[r.type].label.includes(q)
      )
      : availableRefs
    return list.slice(0, 30)
  }, [availableRefs, mentionQuery])

  const addReference = (item: AiReferenceOption) => {
    const exists = referencedItems.some((p) => p.type === item.type && p.id === item.id)
    if (mentionTriggerType === 'button') {
      // 点击“引用设定”按钮打开的面板支持连续多选/反选，不自动关闭
      setReferencedItems((prev) =>
        exists
          ? prev.filter((p) => !(p.type === item.type && p.id === item.id))
          : [...prev, { type: item.type, id: item.id, title: item.title }]
      )
      return
    }

    if (!exists) {
      setReferencedItems((prev) => [...prev, { type: item.type, id: item.id, title: item.title }])
    }

    // 如果是通过输入 @xxx 触发的，清理末尾的 @query 并关闭浮层
    if (mentionTriggerType === 'at' && textareaRef.current) {
      const el = textareaRef.current
      const cursor = el.selectionStart ?? input.length
      const before = input.slice(0, cursor)
      const after = input.slice(cursor)
      const match = before.match(/@([^\s@]*)$/)
      if (match) {
        const nextBefore = before.slice(0, before.length - match[0].length)
        setInput(nextBefore + after)
      }
    }

    setMentionOpen(false)
    setMentionQuery('')
    setMentionIndex(0)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const removeReference = (type: AiReferenceOption['type'], id: string) => {
    setReferencedItems((prev) => prev.filter((p) => !(p.type === type && p.id === id)))
  }

  const handleInputChange = (val: string) => {
    setInput(val)
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? val.length
    const before = val.slice(0, cursor)
    const match = before.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionTriggerType('at')
      setMentionQuery(match[1] || '')
      setMentionIndex(0)
      if (!mentionOpen) {
        loadReferences()
        setMentionOpen(true)
      }
    } else if (mentionOpen && mentionTriggerType === 'at') {
      setMentionOpen(false)
    }
  }

  const sendMessage = async (
    content: string,
    preset?: string,
    overrideRefs?: ReferencedItem[],
    usesChapterDraft = false,
  ) => {
    if (!content.trim() || loading) return
    const requestChapterId = chapterId
    const isInitialDraft = usesChapterDraft && preset === 'chapter_gen'
    const chapterDraft = usesChapterDraft && !isInitialDraft ? stripHtml(chapterContent) : ''
    if (usesChapterDraft && !requestChapterId) {
      toast.error('请先选择章节。')
      return
    }
    if (usesChapterDraft && !isInitialDraft && !chapterDraft && preset !== 'continue') {
      toast.error('请先打开有正文的章节。')
      return
    }
    if (chapterDraft.length > MAX_CHAPTER_DRAFT_LENGTH && preset !== 'continue') {
      toast.error('正文超出单次处理范围，请分段处理。')
      return
    }
    const refsToUse = overrideRefs ?? referencedItems
    lastRequestRef.current = { text: content, preset, refs: refsToUse, chapterId: requestChapterId, usesChapterDraft }
    const currentModelObj = models.find((m) => m.id === selectedModel)
    const userMsg: Message = {
      role: 'user',
      content,
      preset,
      chapterId: requestChapterId,
      usesChapterDraft,
      modelLabel: currentModelObj?.label || selectedModel,
      references: refsToUse.length > 0 ? [...refsToUse] : undefined,
    }
    setMessages((prev) => [...prev, userMsg])
    if (!overrideRefs || content === input) {
      setInput('')
      setReferencedItems([])
    }
    setMentionOpen(false)
    setLoading(true)

    const controller = new AbortController()
    generationAbortRef.current = controller
    let fullContent = ''

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        preset,
        chapterId: requestChapterId,
        modelLabel: currentModelObj?.label || selectedModel,
      },
    ])

    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'chat',
          preset: preset || undefined,
          message: content,
          novelId,
          chapterId: requestChapterId,
          chapterDraft: usesChapterDraft
            ? preset === 'continue' ? chapterDraft.slice(-CONTINUATION_CONTEXT_LENGTH) : chapterDraft
            : undefined,
          modelId: selectedModel,
          referencedItems: refsToUse,
          writingStyleId: activeStyleId || 'none',
          skillIds: activeSkillIds,
          promptTags: allPromptTags
            .filter((t) => activeTagIds.includes(t.id))
            .map((t) => t.prompt),
        }),
      })

      if (res.status === 401) {
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: '登录已过期，请重新登录后继续使用 AI。',
            isError: true,
          }
          return copy
        })
        return
      }
      if (res.status === 402) {
        const err = await res.json().catch(() => ({}))
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: err.error || 'Token 余额不足，请前往用户中心充值。',
            isError: true,
          }
          return copy
        })
        return
      }
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error || `AI 调用失败 (HTTP ${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let appliedSkills: string[] = []
      let streamError = ''
      let streamFinished = false
      let lastUpdateTime = 0
      const UPDATE_INTERVAL = 50

      const updateUI = (force = false) => {
        const now = Date.now()
        if (force || now - lastUpdateTime >= UPDATE_INTERVAL) {
          lastUpdateTime = now
          setMessages((prev) => {
            const copy = [...prev]
            copy[copy.length - 1] = {
              role: 'assistant',
              content: fullContent,
              preset,
              modelLabel: currentModelObj?.label || selectedModel,
              references: userMsg.references,
              chapterId: requestChapterId,
              usesChapterDraft,
              appliedSkills,
            }
            return copy
          })
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (!data) continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.delta) {
                fullContent += parsed.delta
                updateUI()
              }
              if (parsed.error) streamError = String(parsed.error)
              if (parsed.done === true) streamFinished = true
              if (Array.isArray(parsed.appliedSkills)) appliedSkills = parsed.appliedSkills
            } catch { }
          }
        }
      }

      if (streamError) throw new Error(streamError)
      if (!streamFinished || !fullContent.trim()) throw new Error('回复未完整生成，请重试。')
      updateUI(true)
      if (fullContent.trim()) {
        appendActionHistory({
          kind: 'reply',
          allowWriteback: allowsAiProseWriteback(content, preset),
          title: content.slice(0, 28) + (content.length > 28 ? '…' : ''),
          preview: markdownToPlainText(fullContent).slice(0, 100),
          fullText: fullContent,
          words: countWords(markdownToPlainText(fullContent)),
          chapterId: requestChapterId,
        })
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setMessages((prev) => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (!last || last.role !== 'assistant') return prev
          if (!last.content.trim() && !fullContent.trim()) return copy.slice(0, -1)
          copy[copy.length - 1] = {
            ...last,
            content: fullContent || last.content,
          }
          return copy
        })
        return
      }
      setMessages((prev) => {
        const copy = [...prev]
        copy[copy.length - 1] = {
          role: 'assistant',
          content: `生成失败：${e.message || '网络异常，请重试'}`,
          isError: true,
        }
        return copy
      })
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null
      setLoading(false)
    }
  }

  const pauseGeneration = () => {
    if (!generationAbortRef.current) return
    generationAbortRef.current.abort()
    toast.info('已暂停生成，已生成的内容会保留。')
  }

  const handleSend = () => {
    sendMessage(input)
  }

  const handleRegenerate = (msgIndex: number) => {
    if (loading) return
    // 找到该条助手消息对应的上一条用户消息
    let userContent = ''
    let userRefs: ReferencedItem[] | undefined
    let userMsgIndex = -1
    for (let k = msgIndex - 1; k >= 0; k--) {
      if (messages[k]?.role === 'user') {
        userContent = messages[k].content
        userRefs = messages[k].references
        userMsgIndex = k
        break
      }
    }
    const presetToUse = messages[msgIndex]?.preset || lastRequestRef.current?.preset
    const textToUse = userContent || lastRequestRef.current?.text || ''
    const refsToUse = userRefs || lastRequestRef.current?.refs
    if (!textToUse.trim()) return
    const previous = messages[userMsgIndex] ?? lastRequestRef.current
    if (previous?.chapterId !== undefined && previous.chapterId !== chapterId) {
      toast.error('请回到原章节再重新生成。')
      return
    }

    if (userMsgIndex >= 0) {
      setMessages((prev) => prev.slice(0, userMsgIndex))
    }
    void sendMessage(textToUse, presetToUse, refsToUse, previous?.usesChapterDraft)
  }

  const openInitialDraft = () => {
    if (!chapterId || loading) return
    setPresetPromptInput(input.trim())
    setPendingPreset({
      id: 'chapter_gen',
      name: '写初稿',
      description: currentChapterTitle ? `为「${currentChapterTitle}」生成整章初稿。` : '为当前章节生成整章初稿。',
      targetChapterId: chapterId,
    })
  }

  const isInitialDraftPreset = pendingPreset?.id === 'chapter_gen'

  const submitPendingPreset = () => {
    const goal = presetPromptInput.trim()
    if (!pendingPreset || !goal || loading) return
    if (isInitialDraftPreset && pendingPreset.targetChapterId !== chapterId) {
      toast.error('请回到原章节，或重新打开「写初稿」。')
      return
    }
    setPendingPreset(null)
    void sendMessage(isInitialDraftPreset ? `本章核心事件：\n${goal}` : goal, pendingPreset.id, undefined, isInitialDraftPreset)
  }

  const handlePreset = (p: Preset) => {
    setPresetOpen(false)
    if (p.id === 'break_block') {
      void sendMessage('请基于当前章节及引用的内容，给出不同的剧情破局方向。', p.id)
    } else {
      setPresetPromptInput('')
      setPendingPreset(p)
    }
  }

  const handleOpenBranch = (seedContent: string) => {
    setBranchSeed(seedContent)
    setBranchMessages([])
    setBranchInput('')
  }

  const handleSendBranch = async () => {
    const text = branchInput.trim()
    if (!text || branchLoading || !branchSeed) return
    const nextHistory = [...branchMessages, { role: 'user' as const, content: text }]
    setBranchMessages([...nextHistory, { role: 'assistant' as const, content: '' }])
    setBranchInput('')
    setBranchLoading(true)

    try {
      const historyText = nextHistory
        .slice(0, -1)
        .map((m) => `${m.role === 'user' ? '作者' : 'AI'}: ${m.content}`)
        .join('\n')
      const compiledPrompt = `【引用片段/原讨论起点】\n"""\n${branchSeed.slice(0, 2500)}\n"""\n${historyText ? `\n【分支讨论记录】\n${historyText}\n` : ''
        }\n【作者最新问题/要求】\n${text}`

      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          novelId,
          chapterId,
          message: compiledPrompt,
          modelId: selectedModel,
          writingStyleId: activeStyleId || 'none',
          skillIds: activeSkillIds,
        }),
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: '请求失败' }))
        throw new Error(err.error || '分支讨论请求失败')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            if (parsed.delta) {
              acc += parsed.delta
              setBranchMessages((prev) => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: acc }
                return copy
              })
            } else if (parsed.error) {
              throw new Error(parsed.error)
            }
          } catch (e: any) {
            if (e?.message && !e.message.includes('JSON')) throw e
          }
        }
      }
    } catch (e: any) {
      toast.error(e.message || '分支讨论失败')
      setBranchMessages((prev) => {
        const copy = [...prev]
        if (copy.length > 0 && copy[copy.length - 1].role === 'assistant' && !copy[copy.length - 1].content) {
          copy[copy.length - 1] = { role: 'assistant', content: `生成失败：${e.message || '网络异常'}` }
        }
        return copy
      })
    } finally {
      setBranchLoading(false)
    }
  }

  const handleMergeBranchToMain = () => {
    const replies = branchMessages.filter((m) => m.role === 'assistant' && m.content.trim())
    if (replies.length === 0) {
      toast.error('请先在分支窗口进行至少一轮讨论')
      return
    }
    const lastReply = replies[replies.length - 1].content.trim()
    const userTopics = branchMessages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim())
      .slice(-2)
      .join('；')
    const mergedText = `**【分支讨论结论合并】**${userTopics ? `（聚焦：${userTopics.slice(0, 60)}）` : ''}\n\n${lastReply}`

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: mergedText,
        modelLabel: selectedModel,
      },
    ])
    setBranchSeed(null)
    setBranchMessages([])
    toast.success('已将分支讨论结论合并回主会话')
  }

  const handleClear = () => {
    setMessages([])
    if (novelId) {
      try {
        localStorage.removeItem(`moling_ai_chat_history_${novelId}`)
      } catch { }
    }
  }

  const grouped = presets.reduce<Record<string, Preset[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  return (
    <div className="h-full min-h-0 flex flex-col bg-card overflow-hidden border-l border-border">
      {/* 顶部（靛紫渐变球 + @多文件分析副标题） */}
      <div className="border-b border-border flex items-center px-3.5 py-2.5 gap-2.5 shrink-0 bg-card">
        <div className="w-8 h-8 rounded-[10px] ai-brand-mark flex items-center justify-center shrink-0 text-white">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13.5px] leading-tight truncate">写作 AI 助手</div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {currentChapterTitle || '支持引用多个章节与设定'}
          </div>
        </div>
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-[7px] relative" title="历史记录（回复与替换正文）">
              <History className="w-3.5 h-3.5" />
              {actionHistory.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 sm:w-96 p-3 space-y-2.5" align="end">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-primary" />
                助手历史记录 ({actionHistory.length})
              </div>
              {actionHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActionHistory([])
                    if (novelId) {
                      try {
                        localStorage.removeItem(`moling_ai_action_history_${novelId}`)
                      } catch { }
                    }
                    toast.success('已清空历史记录')
                  }}
                  className="text-[11px] text-muted-foreground hover:text-cinnabar"
                >
                  清空记录
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 border-b border-border pb-2">
              {([
                { id: 'all', label: '全部' },
                { id: 'replace', label: '替换/写入正文' },
                { id: 'reply', label: 'AI 回复' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHistoryFilter(tab.id)}
                  className={`px-2 py-0.5 rounded text-[11px] transition ${historyFilter === tab.id
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
              {(() => {
                const filtered = actionHistory.filter((item) =>
                  historyFilter === 'all' ? true : item.kind === historyFilter
                )
                if (filtered.length === 0) {
                  return (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      暂无记录（对话生成或替换正文后会自动保存在此）
                    </div>
                  )
                }
                return filtered.map((item) => (
                  <div key={item.id} className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-1.5">
                      <Badge
                        variant={item.kind === 'replace' ? 'default' : 'secondary'}
                        className="text-[9px] px-1.5 py-0 shrink-0"
                      >
                        {item.kind === 'replace' ? '替换正文' : 'AI 回复'}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground tnum">
                        {item.words} 字 · {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="font-medium truncate">{item.title}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {item.preview}
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {item.allowWriteback && chapterId && item.chapterId === chapterId && <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-5 px-2 text-[10px]"
                        onClick={() => {
                          const plain = item.kind === 'reply'
                            ? markdownToPlainText(splitSingleChapterAndNotes(item.fullText).bodyMarkdown)
                            : item.fullText
                          if (!onApplyChapterText('append', plain, item.chapterId!)) return
                          appendActionHistory({
                            kind: 'replace',
                            allowWriteback: true,
                            title: `再次写入「${chapters.find((c) => c.id === chapterId)?.title || '当前章节'}」`,
                            preview: plain.slice(0, 100),
                            fullText: plain,
                            words: countWords(plain),
                            chapterId: item.chapterId,
                          })
                          setHistoryOpen(false)
                        }}
                      >
                        插入到当前正文
                      </Button>}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-5 px-2 text-[10px]"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            item.kind === 'reply' ? markdownToPlainText(item.fullText) : item.fullText
                          )
                          toast.success('已复制内容')
                        }}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </PopoverContent>
        </Popover>
        <Popover open={presetOpen} onOpenChange={setPresetOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-[7px]" title="预设指令库">
              <List className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                预设指令库
              </div>
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className="text-xs text-muted-foreground mb-1">{cat}</div>
                  <div className="space-y-1">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handlePreset(p)}
                        className="w-full text-left px-2 py-1.5 hover:bg-muted rounded text-sm flex flex-col"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="写作技能设置" aria-label="写作技能设置">
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div>
              <div className="text-sm font-medium">写作技能</div>
              <p className="mt-0.5 text-xs text-muted-foreground">技能补充写作方法，句式和口吻跟随本次文风。</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={activeSkillIds === undefined ? 'default' : 'outline'} onClick={() => updateSkills(undefined)}>
                按任务自动
              </Button>
              <Button size="sm" variant={activeSkillIds?.length === 0 ? 'default' : 'outline'} onClick={() => updateSkills([])}>
                清空并关闭
              </Button>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer">{activeSkillIds?.length ? `自选技能（${activeSkillIds.length}）` : '自选技能'}</summary>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                {WRITING_SKILLS.map((skill) => (
                  <label key={skill.id} className="flex items-start gap-2 text-xs" title={skill.summary}>
                    <Checkbox checked={activeSkillIds?.includes(skill.id) ?? false} onCheckedChange={(checked) => {
                      const current = activeSkillIds ?? []
                      updateSkills(checked === true ? [...current, skill.id] : current.filter((id) => id !== skill.id))
                    }} />
                    <span>{skill.name}</span>
                  </label>
                ))}
              </div>
            </details>
          </PopoverContent>
        </Popover>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-[7px] text-muted-foreground hover:text-cinnabar" disabled={loading} onClick={handleClear} title="清空对话">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* 对话区：严格限制在面板内部滚动 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3"
      >
        {messages.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center px-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gold/25 to-gold/10 flex items-center justify-center mb-3">
              <Wand2 className="w-5 h-5 text-gold" />
            </div>
            <p className="text-sm font-medium mb-1">写作 AI 助手已就绪</p>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              输入 <span className="font-mono font-medium text-foreground">@</span> 引用章节、大纲或设定，让 AI 进行深度分析与解读
            </p>
            <div className="space-y-1.5 w-full">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Lightbulb className="w-3 h-3" /> 试试：
              </p>
              {[
                '帮我分析当前章节的剧情节奏与爽点',
                '帮我把这一章的结尾改得更有悬念',
                '检查当前剧情和角色设定是否有逻辑冲突',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="w-full text-left text-xs px-3 py-2 bg-muted/50 hover:bg-muted rounded border border-border transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'assistant' && !m.content && loading) return null
          return (
            <div
              key={i}
              className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-7 h-7 rounded-[9px] shrink-0 flex items-center justify-center ${m.role === 'user'
                  ? 'bg-[var(--surface-3)] text-foreground'
                  : 'ai-brand-mark text-white'
                  }`}
              >
                {m.role === 'user' ? (
                  <UserIcon className="w-3.5 h-3.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
              </div>
              <div className={`flex-1 min-w-0 max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
                <div className={`flex items-center gap-1.5 mb-1 flex-wrap ${m.role === 'user' ? 'justify-end' : ''}`}>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {m.role === 'user' ? '我' : 'AI 助手'}
                  </span>
                  {m.role === 'assistant' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[var(--violet)]/30 bg-[var(--violet-soft)] text-[var(--violet)]">
                      长文记忆
                    </Badge>
                  )}
                  {m.preset && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {presets.find((p) => p.id === m.preset)?.name || m.preset}
                    </Badge>
                  )}
                  {m.role === 'assistant' && m.modelLabel && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                      {m.modelLabel}
                    </Badge>
                  )}
                </div>
                {m.references && m.references.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mb-1.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {m.references.map((ref) => {
                      const meta = REF_TYPE_META[ref.type]
                      const Icon = meta.icon
                      return (
                        <span
                          key={`${ref.type}-${ref.id}`}
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${meta.chipClass}`}
                        >
                          <Icon className="w-2.5 h-2.5" />
                          <span className="truncate max-w-[120px]">{ref.title}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
                {m.role === 'user' ? (
                  <div className="inline-block text-[13px] px-3 py-2 rounded-[10px] whitespace-pre-wrap break-words text-left max-w-full bg-[var(--surface-3)] text-foreground border border-border">
                    {m.content}
                  </div>
                ) : (() => {
                  if (!canWriteReply(i)) {
                    return (
                      <div className="inline-block px-3.5 py-2.5 rounded-[12px] text-left max-w-full bg-card border border-border">
                        <MarkdownRenderer content={m.content} />
                      </div>
                    )
                  }
                  const refChapCount = (m.references || []).filter((r) => r.type === 'chapter').length
                  const parsed = !m.isError && !m.usesChapterDraft
                    ? parseMultiChapterSections(m.content, m.references, chapters)
                    : { preamble: '', sections: [], postscript: '' }
                  const isMultiCardMode =
                    parsed.sections.length >= 2 || (refChapCount >= 2 && parsed.sections.length >= 1)
                  const appliedSet = new Set(appliedChapters[i] || [])

                  if (!isMultiCardMode) {
                    const single = !m.isError
                      ? splitSingleChapterAndNotes(m.content)
                      : { leadingNote: '', chapterTitle: null, bodyMarkdown: m.content, trailingNote: '' }
                    const hasSeparatedParts = !!(single.leadingNote || single.trailingNote || single.chapterTitle)

                    if (!hasSeparatedParts) {
                      return (
                        <div className="inline-block px-3.5 py-2.5 rounded-[12px] text-left max-w-full bg-card border border-border border-l-2 border-l-[var(--violet)] shadow-xs overflow-hidden">
                          <MarkdownRenderer content={m.content} />
                        </div>
                      )
                    }

                    return (
                      <div className="space-y-2 max-w-full text-left">
                        {single.leadingNote && (
                          <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                            <MarkdownRenderer content={single.leadingNote} />
                          </div>
                        )}
                        <div className="rounded-[12px] bg-card border border-border border-l-2 border-l-[var(--violet)] shadow-xs overflow-hidden">
                          {single.chapterTitle && (
                            <div className="px-3.5 py-2 bg-muted/40 border-b border-border flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="text-xs font-semibold truncate">{single.chapterTitle}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">正文（插入时仅写入此部分）</span>
                            </div>
                          )}
                          <div className="px-3.5 py-2.5">
                            <MarkdownRenderer content={single.bodyMarkdown} />
                          </div>
                        </div>
                        {single.trailingNote && (
                          <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                            <MarkdownRenderer content={single.trailingNote} />
                          </div>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div className="space-y-2.5 max-w-full text-left">
                      {parsed.preamble && (
                        <div className="inline-block px-3 py-2 rounded-[10px] bg-card border border-border text-xs">
                          <MarkdownRenderer content={parsed.preamble} />
                        </div>
                      )}

                      {parsed.sections.length >= 2 && (
                        <div className="flex items-center justify-between gap-2 flex-wrap rounded-[10px] border border-primary/25 bg-primary/5 px-3 py-2">
                          <span className="text-[11.5px] font-medium text-primary">
                            共 {parsed.sections.length} 个独立章节结果（可单章或一键全部写入）
                          </span>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                            disabled={applyingKey !== null || loading}
                            onClick={() => handleApplyChapterSections(i, parsed.sections)}
                          >
                            {applyingKey === `${i}-all` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            一键全部写入 ({parsed.sections.length}章)
                          </Button>
                        </div>
                      )}

                      {parsed.sections.map((sec) => {
                        const delta = sec.nextWords - sec.prevWords
                        const deltaLabel = delta >= 0 ? `+${delta}字` : `${delta}字`
                        const isApplied = appliedSet.has(sec.chapterId)
                        return (
                          <div
                            key={sec.chapterId}
                            className="rounded-[12px] border border-border border-l-2 border-l-[var(--violet)] bg-card shadow-xs overflow-hidden"
                          >
                            <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="text-xs font-semibold truncate">{sec.title}</span>
                                <span className="text-[10px] text-muted-foreground tnum shrink-0">
                                  {sec.prevWords} → {sec.nextWords}字 ({deltaLabel})
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px] gap-1"
                                  disabled={!sec.content}
                                  onClick={() => {
                                    navigator.clipboard.writeText(sec.content)
                                    toast.success(`已复制「${sec.title}」`)
                                  }}
                                >
                                  <Copy className="w-3 h-3" />
                                  复制
                                </Button>
                                <Button
                                  variant={isApplied ? 'secondary' : 'default'}
                                  size="sm"
                                  className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                                  disabled={applyingKey !== null || loading || !sec.content}
                                  onClick={() => handleApplyChapterSections(i, [sec])}
                                >
                                  {applyingKey === `${i}-${sec.chapterId}` ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : isApplied ? (
                                    <>
                                      <Check className="w-3 h-3 text-jade" />
                                      已写入此章
                                    </>
                                  ) : (
                                    <>
                                      <Send className="w-3 h-3" />
                                      写入此章
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                            <div className="px-3.5 py-2.5 max-h-80 overflow-y-auto">
                              {sec.rawMarkdown ? (
                                <MarkdownRenderer content={sec.rawMarkdown} />
                              ) : (
                                <div className="text-xs text-muted-foreground">正在生成本章内容...</div>
                              )}
                            </div>
                          </div>
                        )
                      })}

                      {parsed.postscript && (
                        <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-xs">
                          <MarkdownRenderer content={parsed.postscript} />
                        </div>
                      )}
                    </div>
                  )
                })()}
                {m.role === 'assistant' && (() => {
                  const allowWriteback = canWriteReply(i)
                  const hasMultiSections = !m.usesChapterDraft && (m.references || []).filter((ref) => ref.type === 'chapter').length >= 2
                  const canApplyHere = allowWriteback && !!m.chapterId && m.chapterId === chapterId && !loading

                  return (
                    <div className="mt-1.5 space-y-2">
                      {!!m.appliedSkills?.length && (
                        <p className="text-[10px] text-muted-foreground">已用技能 · {m.appliedSkills.join('、')}</p>
                      )}
                      {!m.isError && allowWriteback && m.chapterId && m.chapterId !== chapterId && !hasMultiSections && (
                        <p className="text-[10px] text-muted-foreground">回到「{chapters.find((chapter) => chapter.id === m.chapterId)?.title || '原章节'}」可写回</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!m.isError && !hasMultiSections && (
                          <>
                            {canApplyHere && (
                              <>
                                {(!m.usesChapterDraft || (m.preset !== 'polish' && m.preset !== 'chapter_gen')) && (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                                    title="安全追加到当前章节末尾（不覆盖原稿）"
                                    onClick={() => {
                                      const cleanBody = splitSingleChapterAndNotes(m.content).bodyMarkdown
                                      const plain = markdownToPlainText(cleanBody)
                                      if (!m.chapterId || !onApplyChapterText('append', plain, m.chapterId)) return
                                      const targetTitle = chapters.find((c) => c.id === chapterId)?.title || '当前章节'
                                      appendActionHistory({
                                        kind: 'replace',
                                        allowWriteback: true,
                                        title: `追加写入「${targetTitle}」`,
                                        preview: plain.slice(0, 100),
                                        fullText: plain,
                                        words: countWords(plain),
                                        chapterId: m.chapterId,
                                      })
                                    }}
                                  >
                                    <Send className="w-3 h-3" />
                                    追加到正文
                                  </Button>
                                )}
                                {m.preset !== 'continue' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 text-[11px] gap-1 rounded-[7px] text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                    title="清空原章节内容并整章替换（会弹窗确认）"
                                    onClick={() => {
                                      if (m.chapterId) previewReplacement(m.content, m.chapterId)
                                    }}
                                  >
                                    {m.usesChapterDraft && m.preset === 'chapter_gen' ? '预览并写入' : '替换整章'}
                                  </Button>
                                )}
                              </>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                              onClick={() => {
                                const copyText = allowWriteback
                                  ? markdownToPlainText(splitSingleChapterAndNotes(m.content).bodyMarkdown)
                                  : m.content
                                navigator.clipboard.writeText(copyText)
                                setCopiedIndex(i)
                                toast.success('已复制')
                                setTimeout(() => setCopiedIndex(null), 1500)
                              }}
                            >
                              {copiedIndex === i ? <Check className="w-3 h-3 text-jade" /> : <Copy className="w-3 h-3" />}
                              复制
                            </Button>
                          </>
                        )}
                        <Button
                          variant={m.isError ? 'default' : 'ghost'}
                          size="sm"
                          disabled={loading}
                          className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                          onClick={() => handleRegenerate(i)}
                          title="重新生成"
                        >
                          <RefreshCw className="w-3 h-3" />
                          {m.isError ? '刷新重试' : '重新生成'}
                        </Button>
                        {!m.isError && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loading}
                            className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px] text-indigo-600 dark:text-indigo-400"
                            onClick={() => handleOpenBranch(m.content)}
                            title="引用此回复另开独立窗口讨论，讨论完可合并回主会话"
                          >
                            <GitBranch className="w-3 h-3" />
                            分支讨论
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )
        })}

        {loading && !messages.some((m) => m.role === 'assistant' && m.content) && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold/25 to-gold/10 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-gold" />
            </div>
            <div className="bg-gold/10 border border-gold/25 rounded-lg px-3 py-2 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-gold" />
              <span className="text-sm text-muted-foreground">思考中</span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区（含 @ 引用浮层、已选文件标签、模型选择器） */}
      <div className="p-3 border-t border-border shrink-0 relative bg-card/50">
        {/* @ 文件引用浮层 */}
        {mentionOpen && (
          <div className="absolute left-3 right-3 bottom-full mb-1.5 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between bg-muted/40">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <AtSign className="w-3.5 h-3.5 text-primary" />
                选择要引用的文件或设定（支持多选）
              </span>
              <button
                type="button"
                onClick={() => setMentionOpen(false)}
                className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 font-medium"
              >
                完成
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
              {filteredRefs.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  未找到匹配的章节或设定
                </div>
              ) : (
                filteredRefs.map((item, idx) => {
                  const meta = REF_TYPE_META[item.type]
                  const Icon = meta.icon
                  const alreadyAdded = referencedItems.some(
                    (r) => r.type === item.type && r.id === item.id
                  )
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      onClick={() => addReference(item)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition ${idx === mentionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                        }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                        {alreadyAdded ? '已引用' : meta.label}
                      </Badge>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* 已 @ 引用的文件标签 + 已启用的提示词标签 + 添加引用按钮 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto">
          {allPromptTags
            .filter((t) => activeTagIds.includes(t.id))
            .map((tag) => (
              <span
                key={`active-tag-${tag.id}`}
                title={`${tag.prompt}\n（点击标签可修改内容）`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[7px] border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <button
                  type="button"
                  onClick={() => startEditTag(tag)}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Tag className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[120px]">{tag.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => togglePromptTag(tag.id)}
                  className="hover:opacity-70 ml-0.5"
                  title="取消此提示词标签"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          {referencedItems.map((ref) => {
            const meta = REF_TYPE_META[ref.type]
            const Icon = meta.icon
            return (
              <span
                key={`${ref.type}-${ref.id}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[7px] border border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand-ink)]"
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[130px]">{ref.title}</span>
                <button
                  type="button"
                  onClick={() => removeReference(ref.type, ref.id)}
                  className="hover:opacity-70 ml-0.5"
                  title="移除引用"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setMentionTriggerType('button')
              setMentionQuery('')
              setMentionIndex(0)
              loadReferences()
              setMentionOpen((v) => !v)
            }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[7px] border border-border bg-card hover:bg-[var(--surface-3)] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" />
            引用设定
          </button>
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {DAILY_TASKS.map((task) => (
            <Tooltip key={task.id}>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs"
                    disabled={loading || !chapterId} onClick={() => {
                      if (task.id === 'chapter_gen') {
                        openInitialDraft()
                        return
                      }
                      const message = [task.instruction, input.trim()].filter(Boolean).join('\n\n')
                      void sendMessage(message, task.id, undefined, true)
                    }}>
                    {task.label}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 leading-relaxed">
                {task.description}
              </TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs gap-1"
                  disabled={loading || !chapterId} onClick={() => {
                    if (chapterId) setDeepChapter({ chapterId, goal: input.trim() })
                  }}>
                  <Wand2 className="h-3.5 w-3.5" /> 深度成章
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72 leading-relaxed">
              适合关键转折、高潮或容易出现设定冲突的章节。先生成章纲并检查设定、动机和时间线，通过后再生成正文，可选精修。
            </TooltipContent>
          </Tooltip>
        </div>

        {/* 一体化 AI 输入框 */}
        <div className="rounded-[12px] border border-[var(--line-2)] bg-[var(--surface-2)] focus-within:border-primary focus-within:bg-card transition-colors p-2.5">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="输入问题，或输入 @ 引用多个章节/设定进行分析..."
            rows={2}
            className="resize-none text-[13px] min-h-[44px] max-h-28 border-0 bg-transparent p-0 focus-visible:ring-0 shadow-none"
            onKeyDown={(e) => {
              if (mentionOpen && filteredRefs.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMentionIndex((prev) => (prev + 1) % filteredRefs.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex((prev) => (prev - 1 + filteredRefs.length) % filteredRefs.length)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const target = filteredRefs[mentionIndex]
                  if (target) addReference(target)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMentionOpen(false)
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />

          <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-border/60">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger className="h-6 w-auto min-w-[110px] max-w-[160px] text-[11px] px-2 gap-1 border-0 bg-transparent shadow-none hover:bg-[var(--surface-3)] rounded-[6px]">
                      <Sparkles className="w-3 h-3 text-primary shrink-0" />
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {models.map((m) => {
                        const locked = !!m.locked || (!!m.isPro && !hasProAiAccess(userPlan))
                        return (
                          <SelectItem key={m.id} value={m.id} disabled={locked} className="text-xs">
                            <div className="flex flex-col gap-0.5 py-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-medium">{m.label}</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0">
                                  {locked ? '月卡/年卡可用' : m.badge}
                                </Badge>
                              </div>
                              {m.description && (
                                <span className="text-[10px] text-muted-foreground">{m.description}</span>
                              )}
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-xs text-xs space-y-1 p-2.5 bg-popover text-popover-foreground border border-border shadow-lg">
                {models.map((m) => (
                  <div key={m.id}>
                    <span className="font-mono font-semibold">{m.label}</span>：{m.description}
                  </div>
                ))}
              </TooltipContent>
            </Tooltip>

            <button
              type="button"
              onClick={() => setStyleDialogOpen(true)}
              className={`h-6 px-2 rounded-[6px] text-[11px] inline-flex items-center gap-1 transition-colors max-w-[115px] ${activeStyleId
                ? 'bg-primary/10 text-primary border border-primary/25 font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-[var(--surface-3)]'
                }`}
              title="设置或从样文提炼作者文风"
            >
              <Feather className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {writingStyles.find((s) => s.id === activeStyleId)?.name || '我的文风'}
              </span>
            </button>

            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`h-6 px-2 rounded-[6px] text-[11px] inline-flex items-center gap-1 transition-colors shrink-0 ${activeTagIds.length > 0
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[var(--surface-3)]'
                    }`}
                  title="添加附加提示词标签（如：简要说明修改点）"
                >
                  <Tag className="w-3 h-3 shrink-0" />
                  <span>提示词{activeTagIds.length > 0 ? ` (${activeTagIds.length})` : ''}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3 space-y-3" align="start" side="top">
                <div className="space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-primary" />
                    附加提示词标签
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    勾选后将自动附带到每次 AI 对话与修改指令中
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {(() => {
                    const availableTags = allPromptTags.filter(
                      (tag) => !activeTagIds.includes(tag.id) || editingTagId === tag.id
                    )
                    if (availableTags.length === 0) {
                      return (
                        <div className="text-[11px] text-muted-foreground py-1">
                          当前可选标签已全部启用（点击输入框上方标签的 × 可取消并回到此处）
                        </div>
                      )
                    }
                    return availableTags.map((tag) => {
                      const isEditingThis = editingTagId === tag.id
                      return (
                        <div
                          key={tag.id}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${isEditingThis
                              ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium'
                              : 'border-border bg-card hover:bg-muted text-foreground'
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => togglePromptTag(tag.id)}
                            className="inline-flex items-center gap-1"
                            title={tag.prompt}
                          >
                            <span>{tag.label}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditTag(tag)}
                            className="ml-0.5 text-muted-foreground hover:text-primary"
                            title="修改此标签"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                          {!tag.builtin && (
                            <button
                              type="button"
                              onClick={() => handleDeletePromptTag(tag.id)}
                              className="text-muted-foreground hover:text-cinnabar"
                              title="删除自定义标签"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })
                  })()}
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {editingTagId ? '修改提示词标签' : '新增自定义提示词标签'}
                    </span>
                    {editingTagId && (
                      <button
                        type="button"
                        onClick={resetTagForm}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        取消编辑
                      </button>
                    )}
                  </div>
                  <Input
                    value={newTagLabel}
                    onChange={(e) => setNewTagLabel(e.target.value)}
                    placeholder="标签名（如：简要说明修改点）"
                    className="h-7 text-xs"
                  />
                  <Textarea
                    value={newTagPrompt}
                    onChange={(e) => setNewTagPrompt(e.target.value)}
                    placeholder="具体提示词要求（如：修改后列出3-5条修改说明）"
                    rows={2}
                    className="text-xs resize-none"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full h-7 text-xs gap-1"
                    onClick={handleSavePromptTag}
                  >
                    {editingTagId ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {editingTagId ? '保存修改' : '添加并启用标签'}
                  </Button>
                </div>

                <div className="pt-2 border-t border-border space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    我的设定库提示词（点击调用）
                  </div>
                  {marketPrompts.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-muted/20 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                      设定库中暂未套用提示词，可前往「AI 工具箱 → 提示词模板市场」点击「套用」，或在「设定库 → 提示词模板」中新建。
                    </div>
                  ) : (() => {
                    const availableMarketPrompts = marketPrompts.filter(
                      (mp) => !activeTagIds.includes(`mp_${mp.id}`)
                    )
                    if (availableMarketPrompts.length === 0) {
                      return (
                        <div className="text-[11px] text-muted-foreground py-1">
                          已套用的设定库提示词均已启用（点击上方标签 × 可取消并回到此处）
                        </div>
                      )
                    }
                    return (
                      <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
                        {availableMarketPrompts.map((mp) => (
                          <div
                            key={mp.id}
                            className="rounded-md border border-border bg-muted/20 p-2 space-y-1 text-[11px]"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-medium truncate">{mp.title}</span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                                {mp.category}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground line-clamp-1">{mp.description}</p>
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-5 px-2 text-[10px]"
                                onClick={() => {
                                  const tagId = `mp_${mp.id}`
                                  const exists = promptTags.find((t) => t.id === tagId)
                                  const nextTags = exists
                                    ? promptTags
                                    : [...promptTags, { id: tagId, label: mp.title.slice(0, 16), prompt: mp.promptText }]
                                  const nextActive = activeTagIds.includes(tagId)
                                    ? activeTagIds
                                    : [...activeTagIds, tagId]
                                  setActiveTagIds(nextActive)
                                  persistPromptTags(nextTags, nextActive)
                                  toast.success(`已启用提示词标签「${mp.title}」`)
                                }}
                              >
                                作为标签启用
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-5 px-2 text-[10px]"
                                onClick={() => {
                                  setInput((prev) => (prev ? `${prev}\n${mp.promptText}` : mp.promptText))
                                  setTagPopoverOpen(false)
                                  textareaRef.current?.focus()
                                  toast.success(`已填入「${mp.title}」`)
                                }}
                              >
                                填入输入框
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </PopoverContent>
            </Popover>

            {loading ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={pauseGeneration}
                    className="ml-auto h-7 px-2 rounded-[8px] bg-destructive text-destructive-foreground inline-flex items-center gap-1 text-[11px] hover:opacity-90 transition-opacity shrink-0"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    暂停生成
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 leading-relaxed">
                  中断当前模型请求并保留已经生成的内容，不会自动写入正文。
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="ml-auto w-7 h-7 rounded-[8px] ai-brand-mark text-white inline-flex items-center justify-center disabled:opacity-45 hover:opacity-95 transition-opacity shrink-0"
                title="发送"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 底部快捷分析标签 */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[
            {
              label: '深度解读分析',
              desc: '一键发送：解读当前章节及关联设定材料的核心剧情与亮点（只读分析，不改稿）',
              prompt: '请深度解读并分析当前章节及关联材料的核心剧情与亮点',
            },
          ].map((quick) => (
            <button
              key={quick.label}
              type="button"
              disabled={loading}
              title={quick.desc}
              onClick={() => sendMessage(input.trim() ? `${quick.prompt}\n\n${input.trim()}` : quick.prompt)}
              className="text-[11px] px-2.5 py-1 rounded-[7px] border border-border bg-card hover:bg-[var(--surface-3)] text-muted-foreground hover:text-foreground transition-colors"
            >
              {quick.label}
            </button>
          ))}
        </div>
      </div>

      <WritingStyleDialog
        open={styleDialogOpen}
        onOpenChange={setStyleDialogOpen}
        novelId={novelId}
        activeStyleId={activeStyleId}
        styles={writingStyles}
        onRefreshStyles={loadWritingStyles}
        onBindStyle={handleBindStyle}
      />

      {/* 预设指令多行输入弹窗（替代原生 window.prompt） */}
      <Dialog open={!!pendingPreset} onOpenChange={(open) => !open && setPendingPreset(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {isInitialDraftPreset ? '写初稿' : `使用预设：${pendingPreset?.name ?? ''}`}
            </DialogTitle>
            {pendingPreset?.description && (
              <DialogDescription className="text-xs">
                {pendingPreset.description}
              </DialogDescription>
            )}
          </DialogHeader>
          <Textarea
            value={presetPromptInput}
            onChange={(e) => setPresetPromptInput(e.target.value)}
            aria-label={isInitialDraftPreset ? '本章要写什么' : '预设指令'}
            placeholder={isInitialDraftPreset ? '本章要发生什么？例如：主角发现账本被换，追到码头时发现船已开走。' : '输入具体要求、剧情片段或参考信息…'}
            rows={4}
            className="text-xs"
            autoFocus
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                submitPendingPreset()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingPreset(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!presetPromptInput.trim() || loading}
              onClick={submitPendingPreset}
            >
              {isInitialDraftPreset ? '生成初稿' : '发送指令'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deepChapter && deepChapter.chapterId === chapterId && (
        <DeepChapterDialog
          key={deepChapter.chapterId}
          open={replacement === null}
          novelId={novelId}
          chapterId={deepChapter.chapterId}
          chapterTitle={currentChapterTitle || '当前章节'}
          chapterContent={chapterContent}
          initialGoal={deepChapter.goal}
          modelId={selectedModel}
          writingStyleId={activeStyleId || 'none'}
          skillIds={activeSkillIds}
          onClose={() => setDeepChapter(null)}
          onPreview={previewReplacement}
        />
      )}

      <AlertDialog open={replacement !== null} onOpenChange={(open) => !open && setReplacement(null)}>
        <AlertDialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl lg:max-w-6xl">
          <AlertDialogHeader>
            <AlertDialogTitle>预览整章替换</AlertDialogTitle>
            <AlertDialogDescription>
              目标章节「{chapters.find((chapter) => chapter.id === replacement?.chapterId)?.title || '原章节'}」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {replacement && (
            <ChapterReplacementDiffPreview
              original={stripHtml(replacement.original)}
              next={replacement.text}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!replacement || replacement.chapterId !== chapterId}
              onClick={() => {
                if (!replacement) return
                const { chapterId: targetChapterId, original, text } = replacement
                if (!onApplyChapterText('replace', text, targetChapterId, original)) return
                const title = chapters.find((chapter) => chapter.id === targetChapterId)?.title || '原章节'
                appendActionHistory({
                  kind: 'replace',
                  allowWriteback: true,
                  title: `替换写入「${title}」`,
                  preview: text.slice(0, 100),
                  fullText: text,
                  words: countWords(text),
                  chapterId: targetChapterId,
                })
                setDeepChapter(null)
                setReplacement(null)
              }}
            >
              确认替换整章
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 分支讨论窗口（类似 ChatGPT Branch：独立推演不污染主对话，完成后一键合并回主会话） */}
      <Dialog open={branchSeed !== null} onOpenChange={(open) => !open && setBranchSeed(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-3.5 border-b border-border shrink-0">
            <DialogTitle className="text-sm flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-primary" />
              独立分支讨论（不污染主会话）
            </DialogTitle>
            <DialogDescription className="text-xs">
              围绕引用的片段或设定反复推演剧情、对白或分支走向，满意后一键合并回主会话继续创作。
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-2.5 bg-muted/30 border-b border-border shrink-0">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">引用起点：</div>
            <div className="text-xs text-foreground/85 line-clamp-3 whitespace-pre-wrap">
              {branchSeed}
            </div>
          </div>

          <div className="flex-1 min-h-[220px] overflow-y-auto p-4 space-y-3">
            {branchMessages.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                输入你想针对这段内容深入探讨的问题（如：“把这里改得更有悬念”、“如果反派此时反水会怎样？”）
              </div>
            ) : (
              branchMessages.map((bm, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg px-3.5 py-2.5 text-xs ${bm.role === 'user'
                      ? 'bg-primary text-primary-foreground ml-10'
                      : 'bg-muted/60 border border-border mr-6'
                    }`}
                >
                  {bm.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{bm.content}</div>
                  ) : (
                    <MarkdownRenderer content={bm.content || '思考中...'} />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="p-3.5 border-t border-border bg-card space-y-2 shrink-0">
            <div className="flex gap-2">
              <Textarea
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
                placeholder="输入分支讨论问题（Ctrl+Enter 发送）..."
                rows={2}
                className="text-xs resize-none flex-1"
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void handleSendBranch()
                  }
                }}
              />
              <Button
                size="sm"
                className="self-end h-8 px-3 text-xs gap-1"
                disabled={branchLoading || !branchInput.trim()}
                onClick={() => void handleSendBranch()}
              >
                {branchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                发送
              </Button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">
                讨论共 {Math.floor(branchMessages.length / 2)} 轮
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setBranchSeed(null)}>
                  关闭
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                  disabled={branchLoading || !branchMessages.some((m) => m.role === 'assistant' && m.content.trim())}
                  onClick={handleMergeBranchToMain}
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  合并结论回主会话
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
