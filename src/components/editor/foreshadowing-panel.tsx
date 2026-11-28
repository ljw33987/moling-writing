'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, ChevronDown, ChevronUp, Anchor } from 'lucide-react'

/**
 * 伏笔追踪面板（登记 → 推进 → 回收状态机）
 * 原创实现，状态机概念借鉴 webnovel-writer（GPL-3.0，仅思想借鉴，零代码复制）。
 * 数据通过 /api/foreshadowing CRUD，自动连载生成后也会自动登记/回收伏笔。
 */

export type ForeshadowingItem = {
  id: string
  novelId: string
  title: string
  description: string | null
  status: string // planted / advanced / resolved / abandoned
  plantedChapter: number | null
  resolvedChapter: number | null
  progressNotes: string | null
  hintWeight: number
}

const STATUS_META: Record<string, { label: string; badge: string; order: number }> = {
  planted: { label: '已埋设', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', order: 0 },
  advanced: { label: '推进中', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', order: 1 },
  resolved: { label: '已回收', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', order: 2 },
  abandoned: { label: '已放弃', badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400', order: 3 },
}

function parseNotes(raw: string | null): Array<{ chapterNum: number; note: string }> {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function ForeshadowingPanel({ novelId }: { novelId: string }) {
  const [items, setItems] = useState<ForeshadowingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 新增表单
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newChapter, setNewChapter] = useState('')
  const [creating, setCreating] = useState(false)

  // 推进记录输入
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<{ foreshadowings: ForeshadowingItem[] }>(
        `/api/foreshadowing?novelId=${novelId}`
      )
      setItems(r.foreshadowings || [])
    } catch {
      // 静默失败，不打断编辑
    } finally {
      setLoading(false)
    }
  }, [novelId])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast.error('请填写伏笔标题')
      return
    }
    setCreating(true)
    try {
      await api('/api/foreshadowing', {
        method: 'POST',
        body: JSON.stringify({
          novelId,
          title: newTitle,
          description: newDesc,
          plantedChapter: newChapter ? Number(newChapter) : undefined,
        }),
      })
      setNewTitle('')
      setNewDesc('')
      setNewChapter('')
      toast.success('伏笔已登记')
      await load()
    } catch (e: any) {
      toast.error(e.message || '登记失败')
    } finally {
      setCreating(false)
    }
  }

  const patch = async (id: string, data: Record<string, unknown>, okMsg?: string) => {
    try {
      await api('/api/foreshadowing', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...data }),
      })
      if (okMsg) toast.success(okMsg)
      await load()
    } catch (e: any) {
      toast.error(e.message || '操作失败')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/foreshadowing?id=${id}`, { method: 'DELETE' })
      toast.success('已删除')
      await load()
    } catch (e: any) {
      toast.error(e.message || '删除失败')
    }
  }

  const handleAddNote = async (item: ForeshadowingItem) => {
    const note = noteDraft[item.id]?.trim()
    if (!note) return
    await patch(
      item.id,
      { progressNote: { note } },
      '推进记录已追加'
    )
    setNoteDraft((d) => ({ ...d, [item.id]: '' }))
  }

  // 按状态分组，组内按权重降序
  const groups = Object.entries(STATUS_META)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([status, meta]) => ({
      status,
      meta,
      list: items
        .filter((i) => i.status === status)
        .sort((a, b) => b.hintWeight - a.hintWeight),
    }))
  const activeCount = items.filter((i) => i.status === 'planted' || i.status === 'advanced').length

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 space-y-2 bg-muted/20">
        <p className="text-xs text-muted-foreground">
          登记伏笔后，AI 续写与自动连载会自动注入活跃伏笔提示（按权重优先），生成后也会自动登记新伏笔、回收已兑现的伏笔。当前活跃伏笔{' '}
          <b className={activeCount > 0 ? 'text-amber-600' : ''}>{activeCount}</b> 条。
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="伏笔标题（如：玄铁令的来历）"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            placeholder="埋设章号"
            value={newChapter}
            onChange={(e) => setNewChapter(e.target.value.replace(/[^0-9]/g, ''))}
            className="h-8 text-sm w-24 shrink-0"
          />
          <Button size="sm" onClick={handleCreate} disabled={creating} className="shrink-0">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            登记
          </Button>
        </div>
        <Textarea
          placeholder="伏笔描述（埋设意图 / 计划回收方式，可选）"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="min-h-[60px] text-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> 加载中…
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          还没有登记伏笔。好伏笔是长篇连载的追读命脉，试着登记第一条吧。
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(({ status, meta, list }) =>
            list.length === 0 ? null : (
              <div key={status} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={meta.badge}>
                    {meta.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{list.length} 条</span>
                </div>
                {list.map((item) => {
                  const notes = parseNotes(item.progressNotes)
                  const expanded = expandedId === item.id
                  return (
                    <div key={item.id} className="rounded-md border p-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          className="text-left text-sm font-medium hover:underline flex-1 flex items-center gap-1.5"
                          onClick={() => setExpandedId(expanded ? null : item.id)}
                        >
                          <Anchor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {item.title}
                          {expanded ? (
                            <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-muted-foreground" title="装配注入权重（越大越优先注入上下文）">
                            权重 {item.hintWeight}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        {item.plantedChapter ? <span>第 {item.plantedChapter} 章埋设</span> : null}
                        {item.resolvedChapter ? <span>第 {item.resolvedChapter} 章回收</span> : null}
                        {notes.length > 0 && <span>{notes.length} 条推进记录</span>}
                      </div>

                      {expanded && (
                        <div className="space-y-2 pt-1 border-t">
                          {item.description && (
                            <p className="text-xs text-muted-foreground pt-1">{item.description}</p>
                          )}
                          {notes.length > 0 && (
                            <div className="space-y-1">
                              {notes.slice(-5).map((n, idx) => (
                                <p key={idx} className="text-xs text-muted-foreground">
                                  {n.chapterNum ? `第 ${n.chapterNum} 章 · ` : ''}
                                  {n.note}
                                </p>
                              ))}
                            </div>
                          )}
                          {(status === 'planted' || status === 'advanced') && (
                            <div className="flex gap-2 pt-1">
                              <Input
                                placeholder="推进记录（本章如何呼应/强化了这条伏笔）"
                                value={noteDraft[item.id] || ''}
                                onChange={(e) => setNoteDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                                className="h-8 text-xs"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0"
                                onClick={() => handleAddNote(item)}
                              >
                                追加
                              </Button>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {status !== 'planted' && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch(item.id, { status: 'planted' }, '已标记为已埋设')}>
                                标为已埋设
                              </Button>
                            )}
                            {status !== 'advanced' && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch(item.id, { status: 'advanced' }, '已标记为推进中')}>
                                标为推进中
                              </Button>
                            )}
                            {(status === 'planted' || status === 'advanced') && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch(item.id, { status: 'resolved' }, '恭喜，伏笔已回收')}>
                                标为已回收
                              </Button>
                            )}
                            {status !== 'abandoned' && status !== 'resolved' && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch(item.id, { status: 'abandoned' }, '已放弃该伏笔')}>
                                放弃
                              </Button>
                            )}
                            {item.hintWeight < 3 && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs" title="提高注入权重" onClick={() => patch(item.id, { hintWeight: item.hintWeight + 1 })}>
                                权重 +1
                              </Button>
                            )}
                            {item.hintWeight > 1 && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs" title="降低注入权重" onClick={() => patch(item.id, { hintWeight: item.hintWeight - 1 })}>
                                权重 -1
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
