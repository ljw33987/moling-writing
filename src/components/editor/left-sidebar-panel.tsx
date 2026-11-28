'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ChapterTree } from './chapter-tree'
import type { Chapter, NovelDetail } from './editor-view'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import {
  BookText,
  FileText,
  Users,
  Save,
  Search,
  AtSign,
  StickyNote,
  Network,
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Feather,
  Pencil,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildInitialMindmapDoc } from './markdown-mindmap'
import type { MindmapFile } from './mindmap-main-panel'
import { WritingStyleDialog, type WritingStyleItem } from '@/components/ai/writing-style-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const BRANCH_PLAN_HEADING = '## 支线出现计划'

interface BranchPlanItem {
  id: string
  name: string
  purpose: string
  status: string
  characters: string
  restriction: string
  notes: string
  beats: BranchBeatItem[]
}

interface BranchBeatItem {
  id: string
  chapter: string
  type: string
  characters: string
  event: string
  result: string
}

const EMPTY_BRANCH_FIELDS: Omit<BranchPlanItem, 'id'> = {
  name: '',
  purpose: '',
  status: '规划中',
  characters: '',
  restriction: '',
  notes: '',
  beats: [],
}

function splitOutlinePlan(value: string) {
  const markerIndex = value.indexOf(BRANCH_PLAN_HEADING)
  if (markerIndex < 0) return { mainOutline: value, branchPlan: '' }
  return {
    mainOutline: value.slice(0, markerIndex).trim(),
    branchPlan: value.slice(markerIndex + BRANCH_PLAN_HEADING.length).trim(),
  }
}

function joinOutlinePlan(mainOutline: string, branchPlan: string) {
  return [
    mainOutline.trim(),
    branchPlan.trim() ? `${BRANCH_PLAN_HEADING}\n${branchPlan.trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

function readBranchField(block: string, label: string) {
  return block.match(new RegExp(`^- ${label}[：:]\\s*(.*)$`, 'm'))?.[1]?.trim() || ''
}

function inlinePlanText(value: string) {
  return value.trim().replace(/\s*\n+\s*/g, '；')
}

function parseBranchPlans(value: string): BranchPlanItem[] {
  if (!value.trim()) return []
  const blocks = value.split(/^### 支线[：:]\s*/m).filter((block) => block.trim())
  if (!/^### 支线[：:]/m.test(value)) {
    return [{ ...EMPTY_BRANCH_FIELDS, id: 'legacy-0', name: '旧支线计划', notes: value.trim() }]
  }
  return blocks.map((block, index) => {
    const [nameLine = '', ...rest] = block.trim().split('\n')
    const body = rest.join('\n')
    const beatBlocks = body.split(/^#### 节点(?:\s+\d+)?\s*$/m).slice(1)
    const storedBeats = beatBlocks.map((beat, beatIndex) => ({
      id: `stored-${index}-beat-${beatIndex}`,
      chapter: readBranchField(beat, '章节位置'),
      type: readBranchField(beat, '节点类型') || '推进',
      characters: readBranchField(beat, '出场人物'),
      event: readBranchField(beat, '发生事件'),
      result: readBranchField(beat, '推进结果'),
    }))
    const legacyStage = readBranchField(body, '出现阶段')
    const legacyTrigger = readBranchField(body, '触发条件')
    const legacyIntersection = readBranchField(body, '主线交汇')
    const legacyCharacters = readBranchField(body, '涉及人物')
    const legacyBeat = [legacyStage, legacyTrigger, legacyIntersection].some(Boolean)
      ? [{
          id: `stored-${index}-beat-legacy`,
          chapter: legacyStage,
          type: legacyTrigger ? '触发' : '推进',
          characters: legacyCharacters,
          event: legacyTrigger,
          result: legacyIntersection,
        }]
      : []
    return {
      id: `stored-${index}`,
      name: nameLine.trim(),
      purpose: readBranchField(body, '支线作用'),
      status: readBranchField(body, '当前状态') || '规划中',
      characters: legacyCharacters || readBranchField(body, '核心人物'),
      restriction: readBranchField(body, '信息禁区') || readBranchField(body, '提前禁区'),
      notes: readBranchField(body, '补充约束'),
      beats: storedBeats.length ? storedBeats : legacyBeat,
    }
  })
}

function serializeBranchPlans(items: BranchPlanItem[]) {
  return items
    .filter((item) => [
      item.name,
      item.purpose,
      item.characters,
      item.restriction,
      item.notes,
    ].some((value) => value.trim()) || (item.beats || []).length > 0)
    .map((item, index) => [
      `### 支线：${item.name.trim() || `未命名支线 ${index + 1}`}`,
      `- 支线作用：${inlinePlanText(item.purpose) || '待定'}`,
      `- 当前状态：${item.status.trim() || '规划中'}`,
      `- 核心人物：${item.characters.trim() || '待定'}`,
      `- 信息禁区：${inlinePlanText(item.restriction) || '无'}`,
      item.notes.trim() ? `- 补充约束：${inlinePlanText(item.notes)}` : '',
      ...(item.beats || []).flatMap((beat, beatIndex) => [
        '',
        `#### 节点 ${beatIndex + 1}`,
        `- 章节位置：${beat.chapter.trim() || '待定'}`,
        `- 节点类型：${beat.type.trim() || '推进'}`,
        `- 出场人物：${beat.characters.trim() || item.characters.trim() || '待定'}`,
        `- 发生事件：${inlinePlanText(beat.event) || '待定'}`,
        `- 推进结果：${inlinePlanText(beat.result) || '待定'}`,
      ]),
    ].filter(Boolean).join('\n'))
    .join('\n\n')
}

function appendListValue(current: string, value: string) {
  const entries = current.split(/[、,，]/).map((entry) => entry.trim()).filter(Boolean)
  if (!entries.includes(value)) entries.push(value)
  return entries.join('、')
}

interface Props {
  novel: NovelDetail
  currentChapterId: string | null
  currentChapterContent?: string
  mindmapFiles: MindmapFile[]
  activeMindmapId: string | null
  onSelectChapter: (id: string) => void
  onSelectMindmap: (id: string) => void
  onCreateMindmap: (file: MindmapFile) => void
  onDeleteMindmap: (id: string) => void
  onTreeChange: (chapterId?: string) => void
  onExtractChapter: (chapter: Chapter) => void
  onWritingStyleChange?: (styleId: string | null) => void
  onInsertCodexRef?: (id: string) => void
}

export function LeftSidebarPanel({
  novel,
  currentChapterId,
  currentChapterContent = '',
  mindmapFiles,
  activeMindmapId,
  onSelectChapter,
  onSelectMindmap,
  onCreateMindmap,
  onDeleteMindmap,
  onTreeChange,
  onExtractChapter,
  onWritingStyleChange,
  onInsertCodexRef,
}: Props) {
  const [tab, setTab] = useState<'chapters' | 'outline' | 'mindmap' | 'codex' | 'notes'>('chapters')
  const [scratchpad, setScratchpad] = useState('')
  const [mindmapLoading, setMindmapLoading] = useState(false)
  const [mindmapScope, setMindmapScope] = useState<'all' | 'custom'>('all')
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(['outline'])
  const [writingStyles, setWritingStyles] = useState<WritingStyleItem[]>([])
  const [styleDialogOpen, setStyleDialogOpen] = useState(false)
  const [activeStyleId, setActiveStyleId] = useState<string | null>(novel.writingStyleId || null)

  useEffect(() => {
    setActiveStyleId(novel.writingStyleId || null)
  }, [novel.writingStyleId])

  const loadWritingStyles = useCallback(async () => {
    try {
      const res = await api<{ styles: WritingStyleItem[] }>('/api/writing-styles')
      setWritingStyles(res.styles || [])
    } catch {}
  }, [])

  useEffect(() => {
    void loadWritingStyles()
    const onUpdated = () => void loadWritingStyles()
    window.addEventListener('moling:writing-styles-updated', onUpdated)
    return () => window.removeEventListener('moling:writing-styles-updated', onUpdated)
  }, [loadWritingStyles])

  const handleBindStyle = async (styleId: string | null) => {
    setActiveStyleId(styleId)
    onWritingStyleChange?.(styleId)
    try {
      await api('/api/novels', {
        method: 'PATCH',
        body: JSON.stringify({ id: novel.id, writingStyleId: styleId }),
      })
      onTreeChange()
    } catch {}
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`moling_scratchpad_${novel.id}`) || ''
      setScratchpad(saved)
    } catch {}
  }, [novel.id])

  const handleNewBlankMindmap = () => {
    const newFile: MindmapFile = {
      id: `mm-${Date.now()}`,
      title: `思维导图 ${mindmapFiles.length + 1}`,
      content: buildInitialMindmapDoc(novel),
      updatedAt: new Date().toISOString(),
    }
    onCreateMindmap(newFile)
    toast.success('已新建思维导图文件')
  }

  const allChapters = novel.volumes.flatMap((v) =>
    v.chapters.map((c) => ({ ...c, volumeTitle: v.title }))
  )
  const currentChapter = allChapters.find((chapter) => chapter.id === currentChapterId)

  const toggleSourceId = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleGenerateMindmapFromSelected = async () => {
    setMindmapLoading(true)
    try {
      const parts: string[] = []
      const includeOutline = mindmapScope === 'all' || selectedSourceIds.includes('outline')
      const targetChapters =
        mindmapScope === 'all'
          ? allChapters
          : allChapters.filter((c) => selectedSourceIds.includes(c.id))

      if (includeOutline && (novel.synopsis?.trim() || novel.outline?.trim())) {
        parts.push(
          `【作品简介与大纲】\n书名：${novel.title}\n简介：${novel.synopsis || '无'}\n大纲：${novel.outline || '无'}`
        )
      }

      for (const ch of targetChapters) {
        const rawContent = ch.id === currentChapterId && currentChapterContent ? currentChapterContent : ch.content
        const plain = (rawContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        if (plain) {
          parts.push(`【${ch.volumeTitle} · ${ch.title}】\n${plain.slice(0, 2000)}`)
        } else {
          parts.push(`【${ch.volumeTitle} · ${ch.title}】（暂无正文）`)
        }
      }

      const material = parts.join('\n\n').trim()
      if (!material) {
        toast.error('请先选择至少一个有内容的文本来源（大纲或章节）')
        return
      }

      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId: novel.id,
          chapterId: currentChapterId,
          message: `请根据以下选定的文本内容，提炼并生成一份结构清晰的思维导图文档。\n严格使用 Markdown 层级格式输出（不要多余解释文字）：\n# 主题标题\n## 一级分支（如：核心冲突、剧情脉络、人物动向、伏笔线索）\n### 二级节点\n- 具体细节\n\n选定参考内容：\n${material.slice(0, 6000)}`,
        }),
      })
      const cleaned = (r.reply || '').replace(/^```markdown\s*/i, '').replace(/```$/i, '').trim()
      if (cleaned) {
        const firstHeading = cleaned.match(/^#\s+(.+)$/m)?.[1]?.trim()
        const newFile: MindmapFile = {
          id: `mm-${Date.now()}`,
          title:
            firstHeading ||
            (mindmapScope === 'all' ? '全书综合导图' : `导图 (${targetChapters.length}章)`),
          content: cleaned,
          updatedAt: new Date().toISOString(),
        }
        onCreateMindmap(newFile)
        toast.success('已生成思维导图文件，点击即可在中间正文区查看')
      }
    } catch (e: any) {
      toast.error(e.message || '生成思维导图失败')
    } finally {
      setMindmapLoading(false)
    }
  }

  const handleScratchpadChange = (val: string) => {
    setScratchpad(val)
    try {
      localStorage.setItem(`moling_scratchpad_${novel.id}`, val)
    } catch {}
  }

  // 简介与大纲编辑状态
  const initialOutlinePlan = splitOutlinePlan(novel.outline || '')
  const [synopsis, setSynopsis] = useState(novel.synopsis || '')
  const [outline, setOutline] = useState(initialOutlinePlan.mainOutline)
  const [branchPlans, setBranchPlans] = useState<BranchPlanItem[]>(
    parseBranchPlans(initialOutlinePlan.branchPlan)
  )
  const [chapterOutline, setChapterOutline] = useState(currentChapter?.summary || '')
  const [savingOutline, setSavingOutline] = useState(false)
  const [generatingOutline, setGeneratingOutline] = useState(false)
  const [savingChapterOutline, setSavingChapterOutline] = useState(false)
  const [generatingChapterOutline, setGeneratingChapterOutline] = useState(false)

  useEffect(() => {
    const nextOutline = splitOutlinePlan(novel.outline || '')
    setSynopsis(novel.synopsis || '')
    setOutline(nextOutline.mainOutline)
    setBranchPlans(parseBranchPlans(nextOutline.branchPlan))
  }, [novel.id, novel.synopsis, novel.outline])

  useEffect(() => {
    setChapterOutline(currentChapter?.summary || '')
  }, [currentChapter?.id, currentChapter?.summary])

  const branchPlan = serializeBranchPlans(branchPlans)

  const addBranchPlan = () => {
    setBranchPlans((previous) => [
      ...previous,
      { ...EMPTY_BRANCH_FIELDS, id: crypto.randomUUID() },
    ])
  }

  const updateBranchPlan = (id: string, patch: Partial<Omit<BranchPlanItem, 'id'>>) => {
    setBranchPlans((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const removeBranchPlan = (id: string) => {
    setBranchPlans((previous) => previous.filter((item) => item.id !== id))
  }

  const addBranchBeat = (branchId: string) => {
    setBranchPlans((previous) => previous.map((branch) => branch.id === branchId
      ? {
          ...branch,
          beats: [
            ...(branch.beats || []),
            {
              id: crypto.randomUUID(),
              chapter: '',
              type: '推进',
              characters: '',
              event: '',
              result: '',
            },
          ],
        }
      : branch))
  }

  const updateBranchBeat = (
    branchId: string,
    beatId: string,
    patch: Partial<Omit<BranchBeatItem, 'id'>>,
  ) => {
    setBranchPlans((previous) => previous.map((branch) => branch.id === branchId
      ? {
          ...branch,
          beats: (branch.beats || []).map((beat) => beat.id === beatId ? { ...beat, ...patch } : beat),
        }
      : branch))
  }

  const removeBranchBeat = (branchId: string, beatId: string) => {
    setBranchPlans((previous) => previous.map((branch) => branch.id === branchId
      ? { ...branch, beats: (branch.beats || []).filter((beat) => beat.id !== beatId) }
      : branch))
  }

  // 设定速查与快捷新建/编辑状态
  const [codexQuery, setCodexQuery] = useState('')
  const [codexItems, setCodexItems] = useState<
    Array<{ id: string; name: string; type: 'character' | 'worldview' | 'item'; summary: string }>
  >([])
  const [codexModalOpen, setCodexModalOpen] = useState(false)
  const [editingCodexId, setEditingCodexId] = useState<string | null>(null)
  const [codexType, setCodexType] = useState<'character' | 'worldview' | 'item'>('character')
  const [codexName, setCodexName] = useState('')
  const [codexSummary, setCodexSummary] = useState('')
  const [savingCodex, setSavingCodex] = useState(false)

  const openCreateCodex = () => {
    setEditingCodexId(null)
    setCodexType('character')
    setCodexName('')
    setCodexSummary('')
    setCodexModalOpen(true)
  }

  const openEditCodex = (item: { id: string; name: string; type: 'character' | 'worldview' | 'item'; summary: string }) => {
    setEditingCodexId(item.id)
    setCodexType(item.type)
    setCodexName(item.name)
    setCodexSummary(item.summary === '暂无描述' ? '' : item.summary)
    setCodexModalOpen(true)
  }

  const handleSaveCodex = async () => {
    if (!codexName.trim()) {
      toast.error('请输入设定名称')
      return
    }
    setSavingCodex(true)
    try {
      const payload: Record<string, any> = {
        type: codexType,
        novelId: novel.id,
        name: codexName.trim(),
      }
      if (codexType === 'character') payload.personality = codexSummary.trim()
      else if (codexType === 'worldview') payload.description = codexSummary.trim()
      else payload.effect = codexSummary.trim()

      if (editingCodexId) {
        await api('/api/characters', {
          method: 'PATCH',
          body: JSON.stringify({ id: editingCodexId, ...payload }),
        })
        toast.success('设定已更新')
      } else {
        await api('/api/characters', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        toast.success('已新建设定，可在正文中直接 @ 引用')
      }
      setCodexModalOpen(false)
      await loadCodex()
      window.dispatchEvent(new CustomEvent('moling:codex-updated'))
    } catch (e: any) {
      toast.error(e.message || '保存设定失败')
    } finally {
      setSavingCodex(false)
    }
  }

  const loadCodex = useCallback(async () => {
    try {
      const [charR, worldR, itemR] = await Promise.all([
        api<{ items: any[] }>(`/api/characters?type=character&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/api/characters?type=worldview&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/api/characters?type=item&novelId=${novel.id}`).catch(() => ({ items: [] })),
      ])
      setCodexItems([
        ...charR.items.map((c) => ({
          id: c.id,
          name: c.name,
          type: 'character' as const,
          summary: c.personality || c.background || '暂无描述',
        })),
        ...worldR.items.map((w) => ({
          id: w.id,
          name: w.name || w.title,
          type: 'worldview' as const,
          summary: w.description || '暂无描述',
        })),
        ...itemR.items.map((i) => ({
          id: i.id,
          name: i.name,
          type: 'item' as const,
          summary: i.effect || i.attributes || '暂无描述',
        })),
      ])
    } catch {}
  }, [novel.id])

  useEffect(() => {
    if (tab !== 'codex' && tab !== 'outline') return
    const timer = setTimeout(() => {
      void loadCodex()
    }, 0)
    return () => clearTimeout(timer)
  }, [tab, loadCodex])

  const branchCharacterOptions = codexItems.filter((item) => item.type === 'character')

  const handleGenerateDetailedOutline = async () => {
    setGeneratingOutline(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId: novel.id,
          message: `请为小说《${novel.title}》（类型：${novel.genre}）生成专业长篇创作大纲与阶段细纲，包含以下 3 个部分（使用 Markdown 标题）：
# 核心主线与阶段目标
# 核心人物关系与立场冲突
# 分章细纲规划（列出接下来 5~8 章的每章目标、核心事件、冲突升级、人物变化、支线触发及结尾钩子）

必须遵守以下支线节点计划。每条支线只在对应章节节点执行指定的铺垫、触发、推进、交汇或回收；没有节点的章节不得擅自推进，信息禁区不得提前揭露：
${branchPlan || '（暂未设置支线出现计划）'}

参考简介：${synopsis || '无'}
参考已有大纲：${outline || '无'}`,
        }),
      })
      if (r.reply?.trim()) {
        setOutline(r.reply.trim())
        toast.success('已生成主支线与分章细纲，确认后可点击保存或转为导图')
      }
    } catch (e: any) {
      toast.error(e.message || '生成细纲失败')
    } finally {
      setGeneratingOutline(false)
    }
  }

  const handleOutlineToMindmap = () => {
    const storedOutline = joinOutlinePlan(outline, branchPlan)
    const baseContent = storedOutline || `# ${novel.title}\n## 核心主线\n- ${synopsis || '待补充'}`
    const newFile: MindmapFile = {
      id: `mm-outline-${Date.now()}`,
      title: `${novel.title} · 主支线细纲导图`,
      content: baseContent.startsWith('#') ? baseContent : `# ${novel.title} 主支线与细纲\n${baseContent}`,
      updatedAt: new Date().toISOString(),
    }
    onCreateMindmap(newFile)
    setTab('mindmap')
    toast.success('已将大纲/细纲转为可视化思维导图')
  }

  const handleSaveOutline = async () => {
    setSavingOutline(true)
    try {
      await api('/api/novels', {
        method: 'PATCH',
        body: JSON.stringify({ id: novel.id, synopsis, outline: joinOutlinePlan(outline, branchPlan) }),
      })
      toast.success('简介与总大纲已保存')
      onTreeChange()
    } catch (e: any) {
      toast.error(e.message || '保存失败')
    } finally {
      setSavingOutline(false)
    }
  }

  const handleGenerateChapterOutline = async () => {
    if (!currentChapter) {
      toast.error('请先选择一个章节')
      return
    }
    setGeneratingChapterOutline(true)
    try {
      const result = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId: novel.id,
          chapterId: currentChapter.id,
          message: `请为「${currentChapter.title}」生成可直接用于写正文的单章细纲。严格按照以下字段输出，不要添加解释：
【本章目标】
【承接前文】
【场景与人物】
【分场推进】按顺序列出 3~6 个场景，每场写清行动、阻碍、信息变化和结果
【人物变化】
【支线安排】说明本章触发、铺垫或暂不出现的支线
【章末钩子】
【禁止提前揭露】

本书主线与阶段大纲：
${outline || '（未填写）'}

支线及章节节点计划：
${branchPlan || '（未设置）'}

当前已有细纲：
${chapterOutline || '（无）'}`,
        }),
      })
      if (result.reply?.trim()) {
        setChapterOutline(result.reply.trim())
        toast.success('当前章细纲已生成，确认后请保存')
      }
    } catch (error: any) {
      toast.error(error.message || '生成当前章细纲失败')
    } finally {
      setGeneratingChapterOutline(false)
    }
  }

  const handleSaveChapterOutline = async () => {
    if (!currentChapter) return
    setSavingChapterOutline(true)
    try {
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({ id: currentChapter.id, summary: chapterOutline.trim() }),
      })
      toast.success('当前章细纲已保存，后续 AI 生成会自动读取')
      onTreeChange(currentChapter.id)
    } catch (error: any) {
      toast.error(error.message || '保存当前章细纲失败')
    } finally {
      setSavingChapterOutline(false)
    }
  }

  const filteredCodex = codexQuery.trim()
    ? codexItems.filter((i) => i.name.toLowerCase().includes(codexQuery.trim().toLowerCase()))
    : codexItems

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'chapters' | 'outline' | 'mindmap' | 'codex' | 'notes')}
        className="flex-1 flex flex-col min-h-0 overflow-hidden gap-0"
      >
        <TabsList className="h-10 w-full grid grid-cols-5 rounded-none bg-card border-b border-border p-0 shrink-0">
          <TabsTrigger
            value="chapters"
            className="h-full min-w-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            目录
          </TabsTrigger>
          <TabsTrigger
            value="outline"
            className="h-full min-w-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            简介
          </TabsTrigger>
          <TabsTrigger
            value="mindmap"
            className="h-full min-w-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            导图
          </TabsTrigger>
          <TabsTrigger
            value="codex"
            className="h-full min-w-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            设定
          </TabsTrigger>
          <TabsTrigger
            value="notes"
            className="h-full min-w-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            速记
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chapters" className="flex-1 overflow-hidden mt-0">
          <ChapterTree
            novel={novel}
            currentChapterId={currentChapterId}
            onSelect={onSelectChapter}
            onChange={onTreeChange}
            onExtractChapter={onExtractChapter}
          />
        </TabsContent>

        <TabsContent value="outline" className="flex-1 overflow-y-auto p-3 space-y-3 mt-0">
          <div className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Feather className="w-3.5 h-3.5 text-primary" />
                作品专属写作风格
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => setStyleDialogOpen(true)}
              >
                配置文风
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              当前：{writingStyles.find((s) => s.id === activeStyleId)?.name || '默认 AI 文风（未绑定个人风格）'}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">作品简介</div>
            <Textarea
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              rows={5}
              className="text-xs resize-y"
              placeholder="输入作品简介..."
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium text-muted-foreground">总大纲 / 阶段细纲</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
                  disabled={generatingOutline}
                  onClick={handleGenerateDetailedOutline}
                  title="根据总大纲和支线出现计划，生成接下来 5~8 章的阶段细纲"
                >
                  {generatingOutline ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-primary" />}
                  {generatingOutline ? '推演中...' : 'AI 生成细纲'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={handleOutlineToMindmap}
                  title="将大纲/细纲转为可视化思维导图"
                >
                  <Network className="w-3 h-3 text-indigo-500" />
                  转导图
                </Button>
              </div>
            </div>
            <Textarea
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              rows={9}
              className="text-xs resize-y"
              placeholder="输入全书核心主线、阶段目标、人物关系与分章规划..."
            />
          </div>

          <div className="space-y-1.5 rounded-md border border-border bg-muted/15 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-medium">支线计划（{branchPlans.length}）</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  每条支线独立设置。保存后，写初稿、续写和深度成章都会读取。
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px] gap-1 shrink-0"
                    onClick={addBranchPlan}
                  >
                    <Plus className="h-3 w-3" />
                    新增支线
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-72 leading-relaxed">
                  新增一条独立剧情线。每条支线可以继续添加多个章节节点，并分别绑定节点类型、出场人物和推进结果。
                </TooltipContent>
              </Tooltip>
            </div>

            {branchPlans.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">
                暂无支线。点击“新增支线”逐条设置，主线内容继续写在上方总大纲中。
              </div>
            ) : (
              <div className="space-y-2">
                {branchPlans.map((branch, index) => (
                  <div key={branch.id} className="space-y-2 rounded-md border border-border bg-card p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">支线 {index + 1}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeBranchPlan(branch.id)}
                            aria-label={`删除支线 ${index + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">删除这条支线计划，不影响其他支线和主线。</TooltipContent>
                      </Tooltip>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block space-y-1 text-[11px]" title="用于在大纲、章节节点和 AI 生成结果中识别这条支线">
                        <span className="font-medium">支线名称</span>
                        <Input
                          value={branch.name}
                          onChange={(event) => updateBranchPlan(branch.id, { name: event.target.value })}
                          className="h-8 text-xs"
                          placeholder="例如：失踪账本"
                        />
                      </label>
                      <label className="block space-y-1 text-[11px]" title="标记这条支线目前处于规划、推进、暂停还是回收状态">
                        <span className="font-medium">当前状态</span>
                        <Select value={branch.status || '规划中'} onValueChange={(status) => updateBranchPlan(branch.id, { status })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="规划中">规划中</SelectItem>
                            <SelectItem value="推进中">推进中</SelectItem>
                            <SelectItem value="暂缓">暂缓</SelectItem>
                            <SelectItem value="已回收">已回收</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>

                    <label className="block space-y-1 text-[11px]" title="说明这条支线为什么存在，以及它最终怎样服务人物成长或核心主线">
                      <span className="font-medium">支线作用</span>
                      <Textarea
                        value={branch.purpose}
                        onChange={(event) => updateBranchPlan(branch.id, { purpose: event.target.value })}
                        rows={2}
                        className="text-xs resize-y"
                        placeholder="例如：通过账本调查让主角发现宗门财务黑洞，并推动他与师父产生第一次立场分歧"
                      />
                    </label>

                    <label className="block space-y-1 text-[11px]" title="这条支线长期涉及的核心人物；每个具体节点还可以单独指定当章出场人物">
                      <span className="font-medium">核心人物</span>
                      <Input
                        value={branch.characters}
                        onChange={(event) => updateBranchPlan(branch.id, { characters: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="例如：林渊、账房先生、周执事"
                      />
                      {branchCharacterOptions.length > 0 && (
                        <Select value="" onValueChange={(characterId) => {
                          const character = branchCharacterOptions.find((item) => item.id === characterId)
                          if (character) updateBranchPlan(branch.id, {
                            characters: appendListValue(branch.characters, character.name),
                          })
                        }}>
                          <SelectTrigger className="h-7 text-[11px]">
                            <SelectValue placeholder="从角色库添加核心人物" />
                          </SelectTrigger>
                          <SelectContent>
                            {branchCharacterOptions.map((character) => (
                              <SelectItem key={character.id} value={character.id}>{character.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </label>

                    <label className="block space-y-1 text-[11px]" title="记录人物身份、真相或线索的知情边界，防止 AI 提前揭露">
                      <span className="font-medium">信息禁区</span>
                      <Input
                        value={branch.restriction}
                        onChange={(event) => updateBranchPlan(branch.id, { restriction: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="例如：节点 3 前不得点明账房先生就是内鬼"
                      />
                    </label>

                    <div className="space-y-2 rounded-md border border-border/70 bg-muted/15 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-medium">章节节点（{(branch.beats || []).length}）</div>
                          <div className="text-[10px] text-muted-foreground">一个节点代表这条支线在某章发生的一次铺垫、推进、转折、交汇或回收。</div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => addBranchBeat(branch.id)}>
                              <Plus className="h-3 w-3" /> 新增节点
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-72 leading-relaxed">
                            给这条支线增加一个具体剧情节点，并绑定章节位置、节点类型和出场人物。AI 会按节点顺序推进支线。
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {(branch.beats || []).length === 0 ? (
                        <div className="rounded border border-dashed border-border px-2 py-3 text-center text-[10px] text-muted-foreground">
                          暂无章节节点。增加节点后，AI 才知道这条支线在哪些章节铺垫、推进或回收。
                        </div>
                      ) : (branch.beats || []).map((beat, beatIndex) => (
                        <div key={beat.id} className="space-y-2 rounded border border-border bg-background p-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium">节点 {beatIndex + 1}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button type="button" size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => removeBranchBeat(branch.id, beat.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">删除这个章节节点，不删除整条支线。</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="space-y-1 text-[10px]" title="节点发生在哪一章或哪个故事阶段，可以填写章节名、章节范围或阶段名称">
                              <span>章节位置</span>
                              <Input value={beat.chapter} onChange={(event) => updateBranchBeat(branch.id, beat.id, { chapter: event.target.value })} className="h-7 text-[11px]" placeholder="例如：第 8 章" />
                            </label>
                            <label className="space-y-1 text-[10px]" title="铺垫只留下线索；触发正式开启；交汇影响主线；回收完成支线">
                              <span>节点类型</span>
                              <Select value={beat.type || '推进'} onValueChange={(type) => updateBranchBeat(branch.id, beat.id, { type })}>
                                <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="铺垫">铺垫</SelectItem>
                                  <SelectItem value="触发">触发</SelectItem>
                                  <SelectItem value="推进">推进</SelectItem>
                                  <SelectItem value="转折">转折</SelectItem>
                                  <SelectItem value="主线交汇">主线交汇</SelectItem>
                                  <SelectItem value="回收">回收</SelectItem>
                                </SelectContent>
                              </Select>
                            </label>
                          </div>
                          <label className="block space-y-1 text-[10px]" title="这个节点实际出场并参与事件的人物，可以少于支线核心人物">
                            <span>出场人物</span>
                            <Input value={beat.characters} onChange={(event) => updateBranchBeat(branch.id, beat.id, { characters: event.target.value })} className="h-7 text-[11px]" placeholder={branch.characters || '例如：林渊、账房先生'} />
                            {branchCharacterOptions.length > 0 && (
                              <Select value="" onValueChange={(characterId) => {
                                const character = branchCharacterOptions.find((item) => item.id === characterId)
                                if (character) updateBranchBeat(branch.id, beat.id, {
                                  characters: appendListValue(beat.characters, character.name),
                                })
                              }}>
                                <SelectTrigger className="h-7 text-[11px]">
                                  <SelectValue placeholder="从角色库添加出场人物" />
                                </SelectTrigger>
                                <SelectContent>
                                  {branchCharacterOptions.map((character) => (
                                    <SelectItem key={character.id} value={character.id}>{character.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </label>
                          <label className="block space-y-1 text-[10px]" title="写清本章发生的具体行动、阻碍或信息变化">
                            <span>发生事件</span>
                            <Textarea value={beat.event} onChange={(event) => updateBranchBeat(branch.id, beat.id, { event: event.target.value })} rows={2} className="text-[11px] resize-y" placeholder="例如：主角发现账本缺失两页，并注意到封蜡来自周执事房间" />
                          </label>
                          <label className="block space-y-1 text-[10px]" title="记录节点结束后人物关系、线索状态或主线局势发生了什么变化">
                            <span>推进结果</span>
                            <Textarea value={beat.result} onChange={(event) => updateBranchBeat(branch.id, beat.id, { result: event.target.value })} rows={2} className="text-[11px] resize-y" placeholder="例如：主角开始怀疑周执事，但暂时没有证据" />
                          </label>
                        </div>
                      ))}
                    </div>

                    <label className="block space-y-1 text-[11px]" title="补充整条支线的节奏、回收方式或其他全局限制">
                      <span className="font-medium">补充约束（选填）</span>
                      <Textarea
                        value={branch.notes}
                        onChange={(event) => updateBranchPlan(branch.id, { notes: event.target.value })}
                        rows={2}
                        className="text-xs resize-y"
                        placeholder="例如：支线最多连续推进两章，之后至少间隔一章回到主线"
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5 rounded-md border border-border bg-muted/15 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium">当前章细纲</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {currentChapter ? `当前：${currentChapter.title}。保存后 AI 写本章时会优先读取。` : '请先在章节目录选择一个章节。'}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px] gap-1 shrink-0"
                disabled={!currentChapter || generatingChapterOutline}
                onClick={handleGenerateChapterOutline}
                title="结合总大纲、支线出现计划和前文生成当前章细纲"
              >
                {generatingChapterOutline ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generatingChapterOutline ? '生成中...' : '生成当前章细纲'}
              </Button>
            </div>
            <Textarea
              value={chapterOutline}
              onChange={(event) => setChapterOutline(event.target.value)}
              rows={8}
              disabled={!currentChapter}
              className="text-xs resize-y"
              placeholder="本章目标、承接前文、分场推进、人物变化、支线安排、章末钩子..."
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs gap-1"
              disabled={!currentChapter || savingChapterOutline}
              onClick={handleSaveChapterOutline}
              title="把当前内容保存为本章细纲，后续 AI 写作会自动读取"
            >
              <Save className="h-3 w-3" />
              {savingChapterOutline ? '保存中...' : '保存当前章细纲'}
            </Button>
          </div>
          <Button
            size="sm"
            className="w-full gap-1.5 bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white border-0 hover:opacity-95"
            onClick={handleSaveOutline}
            disabled={savingOutline}
          >
            <Save className="w-3.5 h-3.5" />
            {savingOutline ? '保存中...' : '保存简介与大纲'}
          </Button>
        </TabsContent>

        <TabsContent value="mindmap" className="flex-1 min-h-0 flex flex-col overflow-hidden p-3 gap-2.5 mt-0">
          <div className="flex items-center justify-between gap-1.5 shrink-0">
            <span className="text-xs font-medium text-muted-foreground">导图文件 ({mindmapFiles.length})</span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={handleNewBlankMindmap}>
              <Plus className="w-3.5 h-3.5" />
              新建导图
            </Button>
          </div>

          {/* 生成来源选择：全部 或 单选/多选指定文本 */}
          <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2 shrink-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">选择生成文本</span>
              <div className="flex items-center border rounded p-0.5 bg-background">
                <button
                  type="button"
                  onClick={() => setMindmapScope('all')}
                  className={`px-2 py-0.5 text-[10px] rounded transition ${
                    mindmapScope === 'all' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-muted-foreground'
                  }`}
                >
                  全部内容
                </button>
                <button
                  type="button"
                  onClick={() => setMindmapScope('custom')}
                  className={`px-2 py-0.5 text-[10px] rounded transition ${
                    mindmapScope === 'custom' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-muted-foreground'
                  }`}
                >
                  指定文本
                </button>
              </div>
            </div>

            {mindmapScope === 'custom' && (
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1 border-t border-border/50 pt-1.5">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded">
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes('outline')}
                    onChange={() => toggleSourceId('outline')}
                  />
                  <span className="truncate">全书简介与大纲</span>
                </label>
                {allChapters.map((ch) => (
                  <label
                    key={ch.id}
                    className="flex items-center gap-1.5 text-[11px] cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.includes(ch.id)}
                      onChange={() => toggleSourceId(ch.id)}
                    />
                    <span className="truncate flex-1">{ch.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{ch.words}字</span>
                  </label>
                ))}
              </div>
            )}

            <Button
              size="sm"
              className="w-full h-7 text-xs gap-1"
              disabled={mindmapLoading}
              onClick={handleGenerateMindmapFromSelected}
            >
              {mindmapLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {mindmapScope === 'all' ? '按全部文本生成导图' : `按已选 (${selectedSourceIds.length}) 生成导图`}
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
            {mindmapFiles.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8 px-3 border border-dashed rounded-md">
                暂无思维导图文件
                <br />
                点击上方「新建导图」或由 AI 生成，点击文件即可在中间正文区查看与编辑
              </div>
            ) : (
              mindmapFiles.map((mf) => {
                const active = activeMindmapId === mf.id
                return (
                  <div
                    key={mf.id}
                    onClick={() => onSelectMindmap(mf.id)}
                    className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border text-xs cursor-pointer transition ${
                      active
                        ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-700 dark:text-indigo-300 font-medium'
                        : 'bg-background border-border hover:bg-muted/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Network className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                      <span className="truncate">{mf.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteMindmap(mf.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                      title="删除导图"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="codex" className="flex-1 flex flex-col overflow-hidden p-3 gap-2 mt-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                value={codexQuery}
                onChange={(e) => setCodexQuery(e.target.value)}
                placeholder="搜索角色/世界观/道具..."
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1 shrink-0"
              onClick={openCreateCodex}
              title="在当前编辑器内直接新建设定，无需跳页"
            >
              <Plus className="w-3.5 h-3.5" />
              新建
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredCodex.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-6 space-y-2">
                <p>暂无设定条目</p>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openCreateCodex}>
                  <Plus className="w-3 h-3" /> 立即新建设定
                </Button>
              </div>
            ) : (
              filteredCodex.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-background p-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-medium truncate">{item.name}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {item.type === 'character' ? '角色' : item.type === 'worldview' ? '世界观' : '道具'}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditCodex(item)}
                        title="就地编辑设定"
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      {onInsertCodexRef && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px] text-indigo-600 dark:text-indigo-400"
                          onClick={() => onInsertCodexRef(item.id)}
                          title="插入 @ 引用到当前光标"
                        >
                          <AtSign className="w-3 h-3 mr-0.5" />
                          引用
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{item.summary}</p>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="notes" className="flex-1 flex flex-col overflow-hidden p-3 gap-2 mt-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground shrink-0">
            <span>本书灵感速记本（自动本地保存）</span>
            <span>{scratchpad.length} 字</span>
          </div>
          <Textarea
            value={scratchpad}
            onChange={(e) => handleScratchpadChange(e.target.value)}
            placeholder="随手记录突发奇想、伏笔备忘、台词金句或后续转折..."
            className="flex-1 resize-none text-xs leading-relaxed"
          />
        </TabsContent>
      </Tabs>

      <WritingStyleDialog
        open={styleDialogOpen}
        onOpenChange={setStyleDialogOpen}
        novelId={novel.id}
        activeStyleId={activeStyleId}
        styles={writingStyles}
        onRefreshStyles={loadWritingStyles}
        onBindStyle={handleBindStyle}
      />

      {/* 编辑器内快捷新建/编辑设定弹窗（无需跳转设定库） */}
      <Dialog open={codexModalOpen} onOpenChange={setCodexModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingCodexId ? '编辑设定条目' : '快捷新建设定（立即用于 @ 引用）'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editingCodexId && (
              <div className="space-y-1">
                <label className="text-xs font-medium">设定分类</label>
                <Select value={codexType} onValueChange={(v) => setCodexType(v as 'character' | 'worldview' | 'item')}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="character">角色卡</SelectItem>
                    <SelectItem value="worldview">世界观</SelectItem>
                    <SelectItem value="item">道具 / 功法</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium">名称 *</label>
              <Input
                value={codexName}
                onChange={(e) => setCodexName(e.target.value)}
                placeholder={codexType === 'character' ? '如：沈听雪' : codexType === 'worldview' ? '如：九幽鬼市' : '如：听魂剑'}
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {codexType === 'character' ? '性格与核心设定' : codexType === 'worldview' ? '世界观详情' : '效果与来历'}
              </label>
              <Textarea
                value={codexSummary}
                onChange={(e) => setCodexSummary(e.target.value)}
                rows={4}
                className="text-xs"
                placeholder="简明描述该设定的关键特征，AI 会自动读取..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCodexModalOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={savingCodex || !codexName.trim()} onClick={handleSaveCodex}>
              {savingCodex ? '保存中...' : '保存设定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
