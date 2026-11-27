'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ChapterTree } from './chapter-tree'
import type { NovelDetail } from './editor-view'
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
  const [synopsis, setSynopsis] = useState(novel.synopsis || '')
  const [outline, setOutline] = useState(novel.outline || '')
  const [savingOutline, setSavingOutline] = useState(false)
  const [generatingOutline, setGeneratingOutline] = useState(false)

  useEffect(() => {
    setSynopsis(novel.synopsis || '')
    setOutline(novel.outline || '')
  }, [novel.id, novel.synopsis, novel.outline])

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
    if (tab !== 'codex') return
    const timer = setTimeout(() => {
      void loadCodex()
    }, 0)
    return () => clearTimeout(timer)
  }, [tab, loadCodex])

  const handleGenerateDetailedOutline = async () => {
    setGeneratingOutline(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId: novel.id,
          message: `请为小说《${novel.title}》（类型：${novel.genre}）生成专业长篇创作大纲与细纲规划，包含以下 4 个部分（使用 Markdown 标题）：
# 核心主线与阶段目标
# 关键支线、伏笔与主线交汇点
# 核心人物关系与立场冲突
# 分章细纲规划（列出接下来 5~8 章的每章核心事件、冲突与结尾钩子）

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
    const baseContent = outline.trim() || `# ${novel.title}\n## 核心主线\n- ${synopsis || '待补充'}`
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
        body: JSON.stringify({ id: novel.id, synopsis, outline }),
      })
      toast.success('简介与总大纲已保存')
      onTreeChange()
    } catch (e: any) {
      toast.error(e.message || '保存失败')
    } finally {
      setSavingOutline(false)
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
            className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            目录
          </TabsTrigger>
          <TabsTrigger
            value="outline"
            className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            简介
          </TabsTrigger>
          <TabsTrigger
            value="mindmap"
            className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            导图
          </TabsTrigger>
          <TabsTrigger
            value="codex"
            className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
          >
            设定
          </TabsTrigger>
          <TabsTrigger
            value="notes"
            className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs font-medium px-1"
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
              <span className="text-xs font-medium text-muted-foreground">总大纲 / 主支线与细纲</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
                  disabled={generatingOutline}
                  onClick={handleGenerateDetailedOutline}
                  title="AI 生成主线、支线关系与分章细纲"
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
              placeholder="输入全书核心主线、支线伏笔、人物关系与分章细纲..."
            />
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
