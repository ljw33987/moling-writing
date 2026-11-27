'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Network,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Loader2,
  ChevronRight,
  ChevronDown,
  FileText,
  Users,
  Globe,
  Gem,
  Clock,
  Plus,
} from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import type { NovelDetail } from './editor-view'

interface MindmapBranch {
  id: string
  label: string
  subtitle?: string
  type: 'root' | 'group' | 'chapter' | 'character' | 'worldview' | 'item' | 'timeline' | 'ai'
  chapterId?: string
  children?: MindmapBranch[]
}

interface Props {
  open: boolean
  onClose: () => void
  novel: NovelDetail
  onJumpChapter?: (chapterId: string) => void
  onTreeChange?: () => void
}

const NODE_COLORS: Record<MindmapBranch['type'], string> = {
  root: 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-indigo-500 shadow-md',
  group: 'bg-card border-border font-semibold text-foreground',
  chapter: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 cursor-pointer',
  character: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
  worldview: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300',
  item: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
  timeline: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
  ai: 'bg-violet-500/10 border-violet-500/40 text-violet-700 dark:text-violet-300',
}

export function StoryMindmapDialog({
  open,
  onClose,
  novel,
  onJumpChapter,
  onTreeChange,
}: Props) {
  const [zoom, setZoom] = useState(1)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [characters, setCharacters] = useState<any[]>([])
  const [worldviews, setWorldviews] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [aiIdea, setAiIdea] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiBranches, setAiBranches] = useState<MindmapBranch[]>([])

  const loadExtra = useCallback(async () => {
    try {
      const [charR, worldR, itemR, timeR] = await Promise.all([
        api<{ items: any[] }>(`/api/characters?type=character&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/api/characters?type=worldview&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/api/characters?type=item&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ events: any[] }>(`/api/timeline?novelId=${novel.id}`).catch(() => ({ events: [] })),
      ])
      setCharacters(charR.items || [])
      setWorldviews(worldR.items || [])
      setItems(itemR.items || [])
      setEvents(timeR.events || [])
    } catch {}
  }, [novel.id])

  useEffect(() => {
    if (open) void loadExtra()
  }, [open, loadExtra])

  const toggleNode = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleAiExpand = async () => {
    setAiLoading(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId: novel.id,
          message: `请为小说《${novel.title}》生成 4 条后续剧情思维导图分支。${aiIdea.trim() ? `作者思路方向：${aiIdea.trim()}。` : ''}请严格按每行一条格式输出："分支标题｜核心冲突或事件简述"（不要序号和多余解释）。`,
        }),
      })
      const lines = (r.reply || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && l.includes('｜'))
        .slice(0, 6)

      const generated: MindmapBranch[] = lines.map((line, i) => {
        const [label, subtitle] = line.split('｜')
        return {
          id: `ai-${Date.now()}-${i}`,
          label: label.replace(/^[-*•\d.\s]+/, '').trim(),
          subtitle: subtitle?.trim(),
          type: 'ai',
        }
      })

      if (generated.length === 0) {
        toast.info('AI 已生成建议，请尝试更具体的方向词')
      } else {
        setAiBranches(generated)
        toast.success(`已生成 ${generated.length} 条剧情思维分支`)
      }
    } catch (e: any) {
      toast.error(e.message || '生成失败')
    } finally {
      setAiLoading(false)
    }
  }

  const handleAppendAiToOutline = async () => {
    if (aiBranches.length === 0) return
    const appendText = aiBranches
      .map((b, idx) => `${idx + 1}. ${b.label}${b.subtitle ? `：${b.subtitle}` : ''}`)
      .join('\n')
    const nextOutline = `${novel.outline ? novel.outline + '\n\n' : ''}【思维导图推演分支】\n${appendText}`
    try {
      await api('/api/novels', {
        method: 'PATCH',
        body: JSON.stringify({ id: novel.id, outline: nextOutline }),
      })
      toast.success('已追加到全书大纲')
      onTreeChange?.()
    } catch (e: any) {
      toast.error(e.message || '写入大纲失败')
    }
  }

  const tree: MindmapBranch = {
    id: 'root',
    label: `《${novel.title}》`,
    subtitle: novel.genre,
    type: 'root',
    children: [
      {
        id: 'group-volumes',
        label: '分卷与章节脉络',
        subtitle: `${novel.volumes.length} 卷`,
        type: 'group',
        children: novel.volumes.map((v) => ({
          id: `vol-${v.id}`,
          label: v.title,
          subtitle: `${v.chapters.length} 章`,
          type: 'group',
          children: v.chapters.map((c) => ({
            id: `ch-${c.id}`,
            label: c.title,
            subtitle: `${c.words} 字`,
            type: 'chapter',
            chapterId: c.id,
          })),
        })),
      },
      {
        id: 'group-characters',
        label: '核心角色图谱',
        subtitle: `${characters.length} 人`,
        type: 'group',
        children: characters.map((c) => ({
          id: `char-${c.id}`,
          label: c.name,
          subtitle: c.personality || c.background?.slice(0, 20),
          type: 'character',
        })),
      },
      {
        id: 'group-worldviews',
        label: '世界观与势力',
        subtitle: `${worldviews.length} 项`,
        type: 'group',
        children: worldviews.map((w) => ({
          id: `wv-${w.id}`,
          label: w.name,
          subtitle: w.type,
          type: 'worldview',
        })),
      },
      {
        id: 'group-items',
        label: '道具与功法',
        subtitle: `${items.length} 件`,
        type: 'group',
        children: items.map((it) => ({
          id: `item-${it.id}`,
          label: it.name,
          subtitle: it.type,
          type: 'item',
        })),
      },
      {
        id: 'group-timeline',
        label: '故事时间线',
        subtitle: `${events.length} 节点`,
        type: 'group',
        children: events.map((ev) => ({
          id: `ev-${ev.id}`,
          label: `${ev.timeLabel} · ${ev.title}`,
          subtitle: ev.description?.slice(0, 24),
          type: 'timeline',
        })),
      },
      ...(aiBranches.length > 0
        ? [
            {
              id: 'group-ai',
              label: 'AI 推演剧情分支',
              subtitle: `${aiBranches.length} 条`,
              type: 'group' as const,
              children: aiBranches,
            },
          ]
        : []),
    ],
  }

  const renderNode = (node: MindmapBranch, depth = 0) => {
    const hasChildren = Boolean(node.children && node.children.length > 0)
    const isCollapsed = !!collapsed[node.id]

    const Icon =
      node.type === 'chapter'
        ? FileText
        : node.type === 'character'
        ? Users
        : node.type === 'worldview'
        ? Globe
        : node.type === 'item'
        ? Gem
        : node.type === 'timeline'
        ? Clock
        : node.type === 'ai'
        ? Sparkles
        : null

    return (
      <div key={node.id} className="flex items-center">
        <div
          onClick={() => {
            if (node.type === 'chapter' && node.chapterId) {
              onJumpChapter?.(node.chapterId)
              onClose()
            } else if (hasChildren) {
              toggleNode(node.id)
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition shrink-0 ${NODE_COLORS[node.type]}`}
        >
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
          <div className="max-w-[200px]">
            <div className="truncate font-medium">{node.label}</div>
            {node.subtitle && (
              <div className="text-[10px] opacity-75 truncate">{node.subtitle}</div>
            )}
          </div>
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleNode(node.id)
              }}
              className="ml-1 opacity-70 hover:opacity-100"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {hasChildren && !isCollapsed && (
          <div className="flex items-center">
            <div className="w-6 h-px bg-border shrink-0" />
            <div className="flex flex-col gap-2.5 border-l-2 border-border/80 pl-5 py-1">
              {node.children!.map((child) => renderNode(child, depth + 1))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl h-[82vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 py-3.5 border-b border-border flex flex-row items-center justify-between shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <Network className="w-4 h-4 text-indigo-500" />
            故事思维导图 · {novel.title}
          </DialogTitle>
          <div className="flex items-center gap-1.5 pr-6">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Badge variant="secondary" className="text-xs font-mono px-2">
              {Math.round(zoom * 100)}%
            </Badge>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setZoom(1)
                setCollapsed({})
              }}
              title="重置视图"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </DialogHeader>

        {/* AI 扩展思维导图工具栏 */}
        <div className="px-5 py-2.5 border-b border-border bg-muted/30 flex flex-wrap items-center gap-2 shrink-0">
          <Input
            value={aiIdea}
            onChange={(e) => setAiIdea(e.target.value)}
            placeholder="输入想推演的剧情方向（可选），AI 自动生成思维导图分支..."
            className="h-8 text-xs flex-1 min-w-0 sm:min-w-[220px] w-full sm:w-auto"
            onKeyDown={(e) => e.key === 'Enter' && handleAiExpand()}
          />
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleAiExpand} disabled={aiLoading}>
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI 生成剧情分支
          </Button>
          {aiBranches.length > 0 && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleAppendAiToOutline}>
              <Plus className="w-3.5 h-3.5" />
              写入大纲
            </Button>
          )}
        </div>

        {/* 思维导图画布 */}
        <div className="flex-1 min-h-0 overflow-auto p-6 bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:20px_20px]">
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            className="inline-block min-w-max pb-8 pr-8 transition-transform duration-150"
          >
            {renderNode(tree)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
