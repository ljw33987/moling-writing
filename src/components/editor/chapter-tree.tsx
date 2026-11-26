'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  BookOpen,
  FileText,
  MoreVertical,
  Trash2,
  Pencil,
  ListTree,
  GripVertical,
  ArrowUp,
  ArrowDown,
  FolderInput,
  Folder,
  Sparkles,
  Loader2,
  CheckSquare,
  X,
} from 'lucide-react'
import { api, CHAPTER_STATUS, formatWords } from '@/lib/helpers'
import type { NovelDetail, Volume, Chapter } from './editor-view'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  novel: NovelDetail
  currentChapterId: string | null
  onSelect: (id: string) => void
  onChange: () => void
}

// 所有章节的扁平列表（带 volumeId），用于跨卷拖拽
interface FlatChapter extends Chapter {
  volumeId: string
}

export function ChapterTree({ novel, currentChapterId, onSelect, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(novel.volumes.map((v) => v.id))
  )
  const [addDialog, setAddDialog] = useState<{ type: 'volume' | 'chapter'; volumeId?: string; isOutline?: boolean } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [isOutline, setIsOutline] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [fileDropVolumeId, setFileDropVolumeId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'volume' | 'chapter'; title: string; batch?: boolean } | null>(null)
  const [dontAskDeleteAgain, setDontAskDeleteAgain] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
  const [selectedVolumeIds, setSelectedVolumeIds] = useState<Set<string>>(new Set())
  const [parseTarget, setParseTarget] = useState<{ title: string; text: string } | null>(null)
  const [parseOptions, setParseOptions] = useState({ characters: true, worldview: true, outline: true })
  const [parsing, setParsing] = useState(false)

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    if (!newTitle.trim()) {
      toast.error('请输入标题')
      return
    }
    try {
      if (addDialog?.type === 'volume') {
        await api('/api/chapters', {
          method: 'POST',
          body: JSON.stringify({
            type: 'volume',
            title: newTitle,
            novelId: novel.id,
            isOutline,
          }),
        })
      } else if (addDialog?.volumeId) {
        await api('/api/chapters', {
          method: 'POST',
          body: JSON.stringify({
            type: 'chapter',
            title: newTitle,
            volumeId: addDialog.volumeId,
            novelId: novel.id,
          }),
        })
      }
      toast.success('已创建')
      setNewTitle('')
      setIsOutline(false)
      setAddDialog(null)
      onChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const performDelete = async (id: string, type: 'volume' | 'chapter', batch = false) => {
    try {
      if (batch) {
        await api('/api/chapters', {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'batchDelete',
            chapterIds: Array.from(selectedChapterIds),
            volumeIds: Array.from(selectedVolumeIds),
          }),
        })
        setSelectedChapterIds(new Set())
        setSelectedVolumeIds(new Set())
        setSelectMode(false)
        toast.success('已批量删除，AI 将不再引用已删内容')
      } else {
        await api(`/api/chapters?id=${id}&type=${type}`, { method: 'DELETE' })
        toast.success('已删除，AI 将不再引用该内容')
      }
      try {
        localStorage.removeItem(`moling_recovery_${novel.id}`)
      } catch {}
      onChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleBatchMove = async (targetVolumeId: string) => {
    if (selectedChapterIds.size === 0) {
      toast.error('请先勾选要移动的章节/文档')
      return
    }
    try {
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'batchMove',
          volumeId: targetVolumeId,
          chapterIds: Array.from(selectedChapterIds),
        }),
      })
      const targetVol = novel.volumes.find((v) => v.id === targetVolumeId)
      setExpanded((prev) => new Set(prev).add(targetVolumeId))
      setSelectedChapterIds(new Set())
      setSelectedVolumeIds(new Set())
      setSelectMode(false)
      toast.success(`已批量移动到「${targetVol?.title || '目标分卷'}」`)
      onChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleBatchDelete = async () => {
    const total = selectedChapterIds.size + selectedVolumeIds.size
    if (total === 0) return
    let skipConfirm = false
    try {
      skipConfirm = localStorage.getItem('moling_skip_delete_confirm') === '1'
    } catch {}
    if (skipConfirm) {
      await performDelete('', 'chapter', true)
      return
    }
    setDontAskDeleteAgain(true)
    setDeleteTarget({
      id: '',
      type: 'chapter',
      title: `选中的 ${total} 项（${selectedVolumeIds.size} 个分卷 / ${selectedChapterIds.size} 篇文档）`,
      batch: true,
    })
  }

  const handleDelete = async (id: string, type: 'volume' | 'chapter', title?: string) => {
    let skipConfirm = false
    try {
      skipConfirm = localStorage.getItem('moling_skip_delete_confirm') === '1'
    } catch {}
    if (skipConfirm) {
      await performDelete(id, type, false)
      return
    }
    setDontAskDeleteAgain(true)
    setDeleteTarget({ id, type, title: title || (type === 'volume' ? '该分卷' : '该章节') })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    if (dontAskDeleteAgain) {
      try {
        localStorage.setItem('moling_skip_delete_confirm', '1')
      } catch {}
    }
    const target = deleteTarget
    setDeleteTarget(null)
    await performDelete(target.id, target.type, !!target.batch)
  }

  const handleExternalFilesDrop = async (files: FileList, targetVolumeId: string) => {
    const validFiles = Array.from(files).filter(
      (f) => f.name.endsWith('.txt') || f.name.endsWith('.md') || f.type.startsWith('text/')
    )
    if (validFiles.length === 0) {
      toast.error('请拖入 .txt 或 .md 文本文件')
      return
    }
    let importedCount = 0
    const collectedTexts: string[] = []
    for (const file of validFiles) {
      try {
        const rawText = await file.text()
        const title = file.name.replace(/\.(txt|md)$/i, '').trim() || '未命名文档'
        collectedTexts.push(`【${title}】\n${rawText.slice(0, 4000)}`)
        const created = await api<{ chapter: { id: string } }>('/api/chapters', {
          method: 'POST',
          body: JSON.stringify({
            type: 'chapter',
            title,
            volumeId: targetVolumeId,
            novelId: novel.id,
          }),
        })
        const htmlContent = rawText
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
          .join('')
        if (htmlContent && created.chapter?.id) {
          await api('/api/chapters', {
            method: 'PATCH',
            body: JSON.stringify({ id: created.chapter.id, content: htmlContent }),
          })
        }
        importedCount++
      } catch (e: any) {
        toast.error(`导入「${file.name}」失败：${e.message}`)
      }
    }
    if (importedCount > 0) {
      setExpanded((prev) => new Set(prev).add(targetVolumeId))
      toast.success(`已导入 ${importedCount} 个文件`)
      onChange()
      if (collectedTexts.length > 0) {
        setParseTarget({
          title: validFiles.length === 1 ? validFiles[0].name : `${importedCount} 个导入文件`,
          text: collectedTexts.join('\n\n').slice(0, 8000),
        })
      }
    }
  }

  const handleParseDocument = async () => {
    if (!parseTarget) return
    if (!parseOptions.characters && !parseOptions.worldview && !parseOptions.outline) {
      toast.error('请至少选择一项要解析的内容')
      return
    }
    setParsing(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId: novel.id,
          message: `请从以下文本中提取结构化信息，严格只输出一个合法 JSON 对象（不要 markdown 代码块或多余解释）：
{
  "characters": [${parseOptions.characters ? '{"name":"角色名","personality":"性格特点","background":"身份背景","abilities":"能力/技能"}' : ''}],
  "worldviews": [${parseOptions.worldview ? '{"name":"设定名称","type":"geography|faction|power|history","description":"设定说明"}' : ''}],
  "outline": ${parseOptions.outline ? '"提取并整理后的卷纲/剧情脉络文本（如无则留空字符串）"' : '""'}
}

待解析文本（${parseTarget.title}）：
${parseTarget.text.slice(0, 7000)}`,
        }),
      })
      const cleaned = (r.reply || '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('AI 未返回有效 JSON 结构')
      const parsed = JSON.parse(jsonMatch[0])

      let charCount = 0
      let worldCount = 0

      if (parseOptions.characters && Array.isArray(parsed.characters)) {
        for (const c of parsed.characters) {
          if (!c?.name?.trim()) continue
          await api('/api/characters', {
            method: 'POST',
            body: JSON.stringify({
              type: 'character',
              novelId: novel.id,
              name: c.name.trim(),
              personality: c.personality || '',
              background: c.background || '',
              abilities: c.abilities || '',
            }),
          })
          charCount++
        }
      }

      if (parseOptions.worldview && Array.isArray(parsed.worldviews)) {
        for (const w of parsed.worldviews) {
          if (!w?.name?.trim()) continue
          await api('/api/characters', {
            method: 'POST',
            body: JSON.stringify({
              type: 'worldview',
              novelId: novel.id,
              name: w.name.trim(),
              worldviewType: w.type || 'geography',
              description: w.description || '',
            }),
          })
          worldCount++
        }
      }

      let outlineUpdated = false
      if (parseOptions.outline && typeof parsed.outline === 'string' && parsed.outline.trim()) {
        const nextOutline = [novel.outline?.trim(), `【${parseTarget.title}】\n${parsed.outline.trim()}`]
          .filter(Boolean)
          .join('\n\n')
        await api('/api/novels', {
          method: 'PATCH',
          body: JSON.stringify({ id: novel.id, outline: nextOutline }),
        })
        outlineUpdated = true
      }

      const summary = [
        charCount > 0 ? `${charCount} 个角色` : '',
        worldCount > 0 ? `${worldCount} 条世界观` : '',
        outlineUpdated ? '卷纲已追加到全书大纲' : '',
      ].filter(Boolean)

      toast.success(summary.length > 0 ? `解析完成：${summary.join('、')}` : '解析完成，未发现可提取条目')
      setParseTarget(null)
      onChange()
    } catch (e: any) {
      toast.error(e.message || '解析失败')
    } finally {
      setParsing(false)
    }
  }

  const handleRename = async (item: Volume | Chapter, _type: 'volume' | 'chapter') => {
    const title = prompt('新标题', item.title)
    if (!title || title === item.title) return
    try {
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({ id: item.id, title }),
      })
      onChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // ============ 拖拽排序 ============
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 收集所有展开卷的章节（每个卷一个 SortableContext）
  const totalWords = novel.volumes.reduce(
    (s, v) => s + v.chapters.reduce((s2, c) => s2 + c.words, 0),
    0
  )

  // 全局拖拽上下文：所有章节可拖到任意展开卷中
  const allChapters: FlatChapter[] = novel.volumes.flatMap((v) =>
    v.chapters.map((c) => ({ ...c, volumeId: v.id }))
  )

  const handleDragStart = (e: DragStartEvent) => {
    setDraggingId(String(e.active.id))
  }

  const reorderVolumeChapters = async (volumeId: string, chapterIds: string[], msg = '已移动') => {
    try {
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'reorder',
          volumeId,
          chapterIds,
        }),
      })
      toast.success(msg)
      onChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const moveChapterStep = async (volume: Volume, chapterId: string, dir: -1 | 1) => {
    const ids = volume.chapters.map((c) => c.id)
    const idx = ids.indexOf(chapterId)
    const nextIdx = idx + dir
    if (idx < 0 || nextIdx < 0 || nextIdx >= ids.length) return
    const nextIds = arrayMove(ids, idx, nextIdx)
    await reorderVolumeChapters(volume.id, nextIds, dir < 0 ? '已上移' : '已下移')
  }

  const moveChapterToVolume = async (chapterId: string, targetVolumeId: string) => {
    const targetVol = novel.volumes.find((v) => v.id === targetVolumeId)
    if (!targetVol) return
    const chapterIds = [...targetVol.chapters.filter((c) => c.id !== chapterId).map((c) => c.id), chapterId]
    setExpanded((prev) => new Set(prev).add(targetVolumeId))
    await reorderVolumeChapters(targetVolumeId, chapterIds, `已移动到「${targetVol.title}」`)
  }

  const moveVolumeStep = async (volumeId: string, dir: -1 | 1) => {
    const ids = novel.volumes.map((v) => v.id)
    const idx = ids.indexOf(volumeId)
    const nextIdx = idx + dir
    if (idx < 0 || nextIdx < 0 || nextIdx >= ids.length) return
    const nextIds = arrayMove(ids, idx, nextIdx)
    try {
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'reorderVolumes',
          novelId: novel.id,
          volumeIds: nextIds,
        }),
      })
      toast.success(dir < 0 ? '分卷已上移' : '分卷已下移')
      onChange()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return

    const activeId = String(active.id)
    const overId = String(over.id)

    const activeCh = allChapters.find((c) => c.id === activeId)
    if (!activeCh) return

    // 拖放到卷标题上（支持拖入空卷或折叠卷）
    if (overId.startsWith('vol-')) {
      const targetVolumeId = overId.slice(4)
      const targetVol = novel.volumes.find((v) => v.id === targetVolumeId)
      if (!targetVol) return
      const nextIds = [...targetVol.chapters.filter((c) => c.id !== activeId).map((c) => c.id), activeId]
      setExpanded((prev) => new Set(prev).add(targetVolumeId))
      await reorderVolumeChapters(targetVolumeId, nextIds, `已移动到「${targetVol.title}」`)
      return
    }

    const overCh = allChapters.find((c) => c.id === overId)
    if (!overCh) return

    const targetVolumeId = overCh.volumeId
    const targetVol = novel.volumes.find((v) => v.id === targetVolumeId)
    if (!targetVol) return

    let nextIds: string[]
    if (activeCh.volumeId === targetVolumeId) {
      const ids = targetVol.chapters.map((c) => c.id)
      const oldIndex = ids.indexOf(activeId)
      const newIndex = ids.indexOf(overId)
      nextIds = arrayMove(ids, oldIndex, newIndex)
    } else {
      const targetIds = targetVol.chapters.map((c) => c.id).filter((id) => id !== activeId)
      const overIndex = targetIds.indexOf(overId)
      targetIds.splice(overIndex >= 0 ? overIndex : targetIds.length, 0, activeId)
      nextIds = targetIds
    }

    await reorderVolumeChapters(targetVolumeId, nextIds)
  }

  const smartCollision: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.length > 0) return pointerCollisions
    return closestCenter(args)
  }

  return (
    <div
      className="h-full flex flex-col bg-card/30 outline-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Delete') return
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
        if (!currentChapterId) return
        const ch = allChapters.find((c) => c.id === currentChapterId)
        if (ch) {
          e.preventDefault()
          void handleDelete(ch.id, 'chapter', ch.title)
        }
      }}
    >
      {/* 顶部 */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <ListTree className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm">章节目录</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {formatWords(totalWords)} 字
        </Badge>
        <Button
          variant={selectMode ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          title={selectMode ? '退出批量管理' : '批量选择（移动/删除）'}
          onClick={() => {
            setSelectMode((v) => !v)
            setSelectedChapterIds(new Set())
            setSelectedVolumeIds(new Set())
          }}
        >
          <CheckSquare className="w-3.5 h-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Plus className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setAddDialog({ type: 'volume', isOutline: false }); setIsOutline(false) }}>
              <BookOpen className="w-3.5 h-3.5 mr-2" />
              新建卷
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setAddDialog({ type: 'volume', isOutline: true }); setIsOutline(true) }}>
              <Folder className="w-3.5 h-3.5 mr-2 text-amber-500" />
              新建粗纲文件夹
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 批量操作条 */}
      {selectMode && (
        <div className="border-b border-border bg-[var(--brand-soft)]/60 px-2.5 py-1.5 flex items-center gap-1.5 text-xs shrink-0">
          <span className="font-medium text-[var(--brand-ink)] truncate">
            已选 {selectedVolumeIds.size + selectedChapterIds.size} 项
          </span>
          <div className="ml-auto flex items-center gap-1">
            {selectedChapterIds.size > 0 && novel.volumes.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1">
                    <FolderInput className="w-3 h-3" />
                    移动到
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                  {novel.volumes.map((v) => (
                    <DropdownMenuItem key={v.id} onClick={() => handleBatchMove(v.id)}>
                      <span className="truncate max-w-[180px]">{v.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[11px] gap-1"
              disabled={selectedVolumeIds.size + selectedChapterIds.size === 0}
              onClick={handleBatchDelete}
            >
              <Trash2 className="w-3 h-3" />
              删除
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => {
                setSelectMode(false)
                setSelectedChapterIds(new Set())
                setSelectedVolumeIds(new Set())
              }}
              title="取消"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 树（含拖拽） */}
      <DndContext
        sensors={sensors}
        collisionDetection={smartCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-y-auto py-2 text-sm">
          {novel.volumes.map((vol, volIdx) => {
            const isExpanded = expanded.has(vol.id)
            return (
              <div
                key={vol.id}
                className={fileDropVolumeId === vol.id ? 'rounded-md ring-1 ring-primary bg-[var(--brand-soft)]/50' : ''}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes('Files')) {
                    e.preventDefault()
                    setFileDropVolumeId(vol.id)
                  }
                }}
                onDragLeave={() => {
                  if (fileDropVolumeId === vol.id) setFileDropVolumeId(null)
                }}
                onDrop={(e) => {
                  if (e.dataTransfer?.files?.length) {
                    e.preventDefault()
                    setFileDropVolumeId(null)
                    void handleExternalFilesDrop(e.dataTransfer.files, vol.id)
                  }
                }}
              >
                <DroppableVolumeRow
                  vol={vol}
                  isExpanded={isExpanded}
                  isFirst={volIdx === 0}
                  isLast={volIdx === novel.volumes.length - 1}
                  selectMode={selectMode}
                  selected={selectedVolumeIds.has(vol.id)}
                  onToggleSelect={() =>
                    setSelectedVolumeIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(vol.id)) next.delete(vol.id)
                      else next.add(vol.id)
                      return next
                    })
                  }
                  onToggle={() => toggle(vol.id)}
                  onAddChapter={() => setAddDialog({ type: 'chapter', volumeId: vol.id })}
                  onRename={() => handleRename(vol, 'volume')}
                  onDelete={() => handleDelete(vol.id, 'volume', vol.title)}
                  onMoveUp={() => moveVolumeStep(vol.id, -1)}
                  onMoveDown={() => moveVolumeStep(vol.id, 1)}
                >
                  {/* 章节列表（可拖拽） */}
                  {isExpanded && (
                    <div className="ml-4">
                      <SortableContext
                        items={vol.chapters.map((c) => c.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {vol.chapters.map((c, chIdx) => (
                          <SortableChapter
                            key={c.id}
                            chapter={c}
                            active={c.id === currentChapterId}
                            selectMode={selectMode}
                            selected={selectedChapterIds.has(c.id)}
                            onToggleSelect={() =>
                              setSelectedChapterIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(c.id)) next.delete(c.id)
                                else next.add(c.id)
                                return next
                              })
                            }
                            volumes={novel.volumes}
                            currentVolumeId={vol.id}
                            isFirst={chIdx === 0}
                            isLast={chIdx === vol.chapters.length - 1}
                            onSelect={onSelect}
                            onRename={() => handleRename(c, 'chapter')}
                            onDelete={() => handleDelete(c.id, 'chapter', c.title)}
                            onParse={() => {
                              const plain = (c.content || '').replace(/<[^>]+>/g, '\n').trim()
                              if (!plain) {
                                toast.error('该文档暂无内容可解析')
                                return
                              }
                              setParseTarget({ title: c.title, text: plain })
                            }}
                            onMoveUp={() => moveChapterStep(vol, c.id, -1)}
                            onMoveDown={() => moveChapterStep(vol, c.id, 1)}
                            onMoveToVolume={(targetVolId) => moveChapterToVolume(c.id, targetVolId)}
                          />
                        ))}
                      </SortableContext>
                      {vol.chapters.length === 0 && (
                        <div className="text-xs text-muted-foreground px-4 py-2 italic">
                          暂无章节（可拖入章节或本地文件）
                        </div>
                      )}
                    </div>
                  )}
                </DroppableVolumeRow>
              </div>
            )
          })}
        </div>

        <DragOverlay>
          {draggingId ? (
            <div className="bg-indigo-600/20 border border-indigo-500/30 rounded px-3 py-1.5 text-sm shadow-lg">
              {allChapters.find((c) => c.id === draggingId)?.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* 新建对话框 */}
      <Dialog open={!!addDialog} onOpenChange={(v) => !v && setAddDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addDialog?.type === 'volume' ? '新建卷' : '新建章节'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>{addDialog?.type === 'volume' ? '卷名' : '章节标题'}</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={addDialog?.type === 'volume' ? '如：第二卷 风起云涌' : '如：第三章 初遇'}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            {addDialog?.type === 'volume' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isOutline"
                  checked={isOutline}
                  onChange={(e) => setIsOutline(e.target.checked)}
                />
                <Label htmlFor="isOutline" className="cursor-pointer">
                  作为大纲卷（仅写大纲，不写正文）
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(null)}>
              取消
            </Button>
            <Button onClick={handleAdd}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 首次删除确认弹窗（确认一次后不再提醒） */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1 text-sm">
            <p className="text-muted-foreground">
              确定要删除{deleteTarget?.type === 'volume' ? '分卷' : '章节'}「<b className="text-foreground">{deleteTarget?.title}</b>」吗？
              {deleteTarget?.type === 'volume' && '（会同时删除该卷下的所有章节）'}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontAskDeleteAgain}
                onChange={(e) => setDontAskDeleteAgain(e.target.checked)}
              />
              后续不再提醒（下次按 Delete 或点击删除将直接删除）
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 解析文件（角色 / 世界观 / 卷纲）弹窗 */}
      <Dialog open={!!parseTarget} onOpenChange={(v) => !v && !parsing && setParseTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              AI 解析导入内容
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1 text-sm">
            <p className="text-xs text-muted-foreground">
              是否让 AI 从「<b className="text-foreground">{parseTarget?.title}</b>」中提取以下信息并自动写入设定库与大纲？
            </p>
            <div className="space-y-2 rounded-[10px] border border-border bg-[var(--surface-2)] p-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={parseOptions.characters}
                  onChange={(e) => setParseOptions((p) => ({ ...p, characters: e.target.checked }))}
                />
                <span>解析角色档案（自动写入设定库）</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={parseOptions.worldview}
                  onChange={(e) => setParseOptions((p) => ({ ...p, worldview: e.target.checked }))}
                />
                <span>解析世界观设定（自动写入设定库）</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={parseOptions.outline}
                  onChange={(e) => setParseOptions((p) => ({ ...p, outline: e.target.checked }))}
                />
                <span>提取卷纲与剧情脉络（追加到全书大纲）</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={parsing} onClick={() => setParseTarget(null)}>
              暂不解析
            </Button>
            <Button
              size="sm"
              disabled={parsing}
              onClick={handleParseDocument}
              className="gap-1.5 bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white border-0"
            >
              {parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {parsing ? '解析中...' : '开始解析'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ 可拖入的分卷容器 ============
function DroppableVolumeRow({
  vol,
  isExpanded,
  isFirst,
  isLast,
  selectMode,
  selected,
  onToggleSelect,
  onToggle,
  onAddChapter,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
  children,
}: {
  vol: Volume
  isExpanded: boolean
  isFirst: boolean
  isLast: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onToggle: () => void
  onAddChapter: () => void
  onRename: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `vol-${vol.id}` })

  return (
    <div>
      <div
        ref={setNodeRef}
        className={`group flex items-center px-2 py-1 rounded-sm cursor-pointer transition-colors ${
          isOver ? 'bg-[var(--brand-soft)] ring-1 ring-primary' : 'hover:bg-muted/50'
        }`}
        onClick={onToggle}
      >
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mr-1.5 accent-primary cursor-pointer shrink-0"
          />
        )}
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        {vol.isOutline ? (
          <Folder className="w-3.5 h-3.5 mr-1.5 text-amber-500 shrink-0" />
        ) : (
          <BookOpen className="w-3.5 h-3.5 mr-1.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
        )}
        <span className="truncate flex-1 font-medium">{vol.title}</span>
        {vol.isOutline && (
          <Badge variant="outline" className="text-[10px] mr-1 px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400">
            粗纲
          </Badge>
        )}
        <span className="text-xs text-muted-foreground mr-1 tnum">
          {vol.chapters.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5"
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddChapter}>
              <Plus className="w-3.5 h-3.5 mr-2" />
              新建章节
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="w-3.5 h-3.5 mr-2" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isFirst} onClick={onMoveUp}>
              <ArrowUp className="w-3.5 h-3.5 mr-2" />
              上移分卷
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={onMoveDown}>
              <ArrowDown className="w-3.5 h-3.5 mr-2" />
              下移分卷
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              删除卷
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </div>
  )
}

// ============ 可拖拽的章节项 ============
function SortableChapter({
  chapter,
  active,
  selectMode,
  selected,
  onToggleSelect,
  volumes,
  currentVolumeId,
  isFirst,
  isLast,
  onSelect,
  onRename,
  onDelete,
  onParse,
  onMoveUp,
  onMoveDown,
  onMoveToVolume,
}: {
  chapter: Chapter
  active: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  volumes: Volume[]
  currentVolumeId: string
  isFirst: boolean
  isLast: boolean
  onSelect: (id: string) => void
  onRename: () => void
  onDelete: () => void
  onParse: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onMoveToVolume: (targetVolumeId: string) => void
}) {
  const status = CHAPTER_STATUS[chapter.status] || CHAPTER_STATUS.draft
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chapter.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group flex items-center pl-2 pr-2 py-1.5 cursor-grab active:cursor-grabbing rounded-sm mx-1 transition ${
        active
          ? 'bg-indigo-600/15 text-indigo-600 dark:text-indigo-400'
          : 'hover:bg-muted/50'
      }`}
      onClick={() => (selectMode ? onToggleSelect() : onSelect(chapter.id))}
      title="点击编辑，按住可拖拽到任意分卷或位置"
    >
      {selectMode ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="mr-1.5 accent-primary cursor-pointer shrink-0"
        />
      ) : (
        <span className="opacity-35 group-hover:opacity-90 p-0.5 shrink-0">
          <GripVertical className="w-3 h-3" />
        </span>
      )}
      <FileText className={`w-3 h-3 mr-1.5 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`} />
      <span className="truncate flex-1 text-[13px]">{chapter.title}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${status.dot} mr-1 shrink-0`} />
      <span className="text-[10px] text-muted-foreground mr-1 tnum">
        {chapter.words > 0 ? formatWords(chapter.words) : ''}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="w-3.5 h-3.5 mr-2" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onParse}>
            <Sparkles className="w-3.5 h-3.5 mr-2 text-primary" />
            AI 解析角色/卷纲
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isFirst} onClick={onMoveUp}>
            <ArrowUp className="w-3.5 h-3.5 mr-2" />
            上移
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onClick={onMoveDown}>
            <ArrowDown className="w-3.5 h-3.5 mr-2" />
            下移
          </DropdownMenuItem>
          {volumes.length > 1 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="w-3.5 h-3.5 mr-2" />
                移动到分卷
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {volumes.map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    disabled={v.id === currentVolumeId}
                    onClick={() => onMoveToVolume(v.id)}
                  >
                    <span className="truncate max-w-[180px]">{v.title}</span>
                    {v.id === currentVolumeId && (
                      <span className="ml-auto text-[10px] text-muted-foreground">当前</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-600" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
