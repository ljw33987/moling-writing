'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ShieldAlert,
  Clock,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
  Plus,
  Wand2,
  Anchor,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Volume } from './editor-view'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import { ForeshadowingPanel } from './foreshadowing-panel'

interface Props {
  novelId: string
  chapterId: string | null
  chapterContent: string
  volumes?: Volume[]
  onJumpChapter?: (chapterId: string) => void
  onInsertAiDraft?: (text: string) => void
  onChapterUpdated?: () => void
}

function htmlToPlainLines(html: string): string[] {
  return (html || '')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function plainToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

function computeLineDiff(origLines: string[], nextLines: string[]) {
  const m = origLines.length
  const n = nextLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origLines[i] === nextLines[j]) dp[i][j] = 1 + dp[i + 1][j + 1]
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Array<{ type: 'same' | 'del' | 'add'; text: string }> = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (origLines[i] === nextLines[j]) {
      ops.push({ type: 'same', text: origLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: origLines[i] })
      i++
    } else {
      ops.push({ type: 'add', text: nextLines[j] })
      j++
    }
  }
  while (i < m) ops.push({ type: 'del', text: origLines[i++] })
  while (j < n) ops.push({ type: 'add', text: nextLines[j++] })
  return ops
}

export function LongNovelTools({
  novelId,
  chapterId,
  chapterContent,
  volumes = [],
  onJumpChapter,
  onInsertAiDraft,
  onChapterUpdated,
}: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('guard')
  const [scope, setScope] = useState<string>(chapterId || 'all')

  useEffect(() => {
    if (open) {
      setScope(chapterId || 'all')
    }
  }, [open, chapterId])

  const allChapters = volumes.flatMap((v) =>
    v.chapters.map((c) => ({ ...c, volumeTitle: v.title }))
  )
  const targetChapterId = scope === 'all' ? null : scope
  const targetChapter = targetChapterId
    ? allChapters.find((c) => c.id === targetChapterId) || null
    : null
  const effectiveContent =
    targetChapterId && targetChapterId !== chapterId
      ? targetChapter?.content || ''
      : chapterContent

  // 2. 时间线
  const [events, setEvents] = useState<any[]>([])
  const [timeLabel, setTimeLabel] = useState('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDesc, setEventDesc] = useState('')
  const [timelineLoading, setTimelineLoading] = useState(false)

  // 3. 一致性守卫
  const [issues, setIssues] = useState<any[]>([])
  const [guardLoading, setGuardLoading] = useState(false)

  // 4. AI 占比 & 去 AI 味 + 对比
  const [ratioData, setRatioData] = useState<any>(null)
  const [natResult, setNatResult] = useState('')
  const [natDiff, setNatDiff] = useState<{
    chapterId: string
    chapterTitle: string
    originalText: string
    rewrittenText: string
    ops: Array<{ type: 'same' | 'del' | 'add'; text: string }>
    applied?: number
    skipped?: number
  } | null>(null)
  const [natLoading, setNatLoading] = useState(false)
  const [applyingDiff, setApplyingDiff] = useState(false)

  const loadTimeline = useCallback(async () => {
    try {
      const r = await api<{ events: any[] }>(`/api/timeline?novelId=${novelId}`)
      setEvents(r.events || [])
    } catch { }
  }, [novelId])

  const loadGuard = useCallback(async () => {
    try {
      const r = await api<{ issues: any[] }>(`/api/guard?novelId=${novelId}`)
      setIssues(r.issues || [])
    } catch { }
  }, [novelId])

  const loadRatio = useCallback(async () => {
    const cid = targetChapterId ?? chapterId
    if (!cid) {
      setRatioData(null)
      return
    }
    try {
      const r = await api(`/api/ai/naturalize?chapterId=${cid}`)
      setRatioData(r)
    } catch { }
  }, [targetChapterId, chapterId])

  // 全书各章 AI 采纳占比：并发逐章统计（确定性统计，零 AI 成本），按占比从高到低排序
  const loadAllRatios = useCallback(async () => {
    setRatioListLoading(true)
    try {
      const withContent = volumes
        .flatMap((v) => v.chapters)
        .filter((c) => (c.content || '').replace(/<[^>]+>/g, '').replace(/\s/g, '').length > 200)
      const out: Array<{ id: string; title: string; aiRatio: number; aiChars: number; humanChars: number }> = []
      let idx = 0
      const CONC = 6
      const workers = Array.from({ length: Math.min(CONC, withContent.length) }, async () => {
        while (idx < withContent.length) {
          const cur = withContent[idx++]
          try {
            const r = await api<{ aiRatio: number; aiChars: number; humanChars: number }>(
              `/api/ai/naturalize?chapterId=${cur.id}`
            )
            out.push({ id: cur.id, title: cur.title, aiRatio: r.aiRatio, aiChars: r.aiChars, humanChars: r.humanChars })
          } catch { }
        }
      })
      await Promise.all(workers)
      out.sort((a, b) => b.aiRatio - a.aiRatio)
      setRatioList(out)
    } catch (e: any) {
      toast.error(e.message || '全书占比统计失败')
    } finally {
      setRatioListLoading(false)
    }
  }, [volumes])

  // 2b. 时间线批量提取草稿（从章节摘要生成，勾选后导入）
  const [extractDrafts, setExtractDrafts] = useState<
    Array<{ chapterId: string; title: string; timeLabel: string; eventTitle: string; description: string; selected: boolean }>
  >([])
  const [extractLoading, setExtractLoading] = useState(false)
  const [extractSaving, setExtractSaving] = useState(false)

  // 3b. 一键修复中的 issue id
  const [fixingId, setFixingId] = useState<string | null>(null)

  // 4b. 全书各章占比列表（发稿终审用）
  const [ratioList, setRatioList] = useState<
    Array<{ id: string; title: string; aiRatio: number; aiChars: number; humanChars: number }>
  >([])
  const [ratioListLoading, setRatioListLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      if (tab === 'timeline') void loadTimeline()
      if (tab === 'guard') void loadGuard()
      if (tab === 'ratio') {
        if (scope === 'all') void loadAllRatios()
        else void loadRatio()
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [open, tab, scope, loadTimeline, loadGuard, loadRatio, loadAllRatios])

  const handleAddEvent = async () => {
    if (!timeLabel.trim() || !eventTitle.trim()) {
      toast.error('请填写时间锚点和事件标题')
      return
    }
    setTimelineLoading(true)
    try {
      await api('/api/timeline', {
        method: 'POST',
        body: JSON.stringify({
          novelId,
          chapterId,
          timeLabel,
          title: eventTitle,
          description: eventDesc,
        }),
      })
      setTimeLabel('')
      setEventTitle('')
      setEventDesc('')
      await loadTimeline()
      toast.success('已添加时间线事件')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTimelineLoading(false)
    }
  }

  const handleDeleteEvent = async (id: string) => {
    try {
      await api(`/api/timeline?id=${id}`, { method: 'DELETE' })
      await loadTimeline()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleRunGuard = async (withAi: boolean) => {
    setGuardLoading(true)
    try {
      const r = await api<{ issues: any[]; scannedCount: number }>('/api/guard', {
        method: 'POST',
        body: JSON.stringify({ novelId, chapterId: targetChapterId, withAi }),
      })
      setIssues(r.issues || [])
      toast.success(`巡检完成，发现 ${r.scannedCount} 项待处理问题`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGuardLoading(false)
    }
  }

  const handleIssueStatus = async (id: string, status: 'resolved' | 'ignored') => {
    try {
      await api('/api/guard', {
        method: 'PATCH',
        body: JSON.stringify({ id, status }),
      })
      await loadGuard()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // 从章节摘要批量生成时间线草稿：跳过正文过短、未填摘要、已导入过的章节
  const handleExtractTimeline = async () => {
    setExtractLoading(true)
    try {
      const { chapters } = await api<{ chapters: any[] }>(`/api/chapters?novelId=${novelId}`)
      const linked = new Set((events as any[]).map((e) => e.chapterId).filter(Boolean))
      const drafts = chapters
        .filter((c: any) => {
          const plain = (c.content || '').replace(/<[^>]+>/g, '').replace(/\s/g, '')
          return plain.length > 500 && !!c.summary?.trim() && !linked.has(c.id)
        })
        .map((c: any, i: number) => {
          const m = (c.title || '').match(/第[0-9一二三四五六七八九十百零〇两]+章/)
          return {
            chapterId: c.id,
            title: c.title,
            timeLabel: m ? m[0] : `章节${i + 1}`,
            eventTitle: c.title,
            description: (c.summary || '').trim(),
            selected: true,
          }
        })
      if (drafts.length === 0) {
        toast.info('没有可提取的章节：需要正文超 500 字、已填摘要、且尚未导入时间线的章节')
        return
      }
      setExtractDrafts(drafts)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setExtractLoading(false)
    }
  }

  const handleImportTimelineDrafts = async () => {
    const picked = extractDrafts.filter((d) => d.selected)
    if (picked.length === 0) {
      toast.error('请至少勾选一个事件')
      return
    }
    setExtractSaving(true)
    let ok = 0
    try {
      for (const d of picked) {
        try {
          await api('/api/timeline', {
            method: 'POST',
            body: JSON.stringify({
              novelId,
              chapterId: d.chapterId,
              timeLabel: d.timeLabel,
              title: d.eventTitle,
              description: d.description,
            }),
          })
          ok++
        } catch { }
      }
      toast.success(`已导入 ${ok}/${picked.length} 条时间线事件`)
      setExtractDrafts([])
      await loadTimeline()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setExtractSaving(false)
    }
  }

  // 一键修复：缺失摘要 → AI 生成写回；失效引用 → 移除正文中的失效标记
  const handleFixIssue = async (issue: any) => {
    if (!issue.chapterId) {
      toast.error('该问题没有关联章节，请手动处理')
      return
    }
    setFixingId(issue.id)
    try {
      if (issue.category === 'timeline') {
        // 走守卫专用接口：平台 AI 直调，不占用户并发槽（避免与润色/生成等撞车）
        const r = await api<{ summary: string }>('/api/guard/fix-summary', {
          method: 'POST',
          body: JSON.stringify({ chapterId: issue.chapterId }),
        })
        toast.success('已生成并写入章节摘要')
        if (r.summary) {
          console.log(`[fix-summary] ${issue.title} → ${r.summary}`)
        }
      } else if (issue.category === 'codex') {
        const { chapter } = await api<{ chapter: { content: string } }>(
          `/api/chapters?id=${issue.chapterId}`
        )
        let html = chapter?.content || ''
        const badIds = (issue.detail || '').match(/[a-zA-Z0-9_-]{15,}/g) || []
        let removed = 0
        for (const id of badIds) {
          const re = new RegExp(`<span[^>]*data-codex-ref=["']${id}["'][^>]*>[\\s\\S]*?</span>`, 'gi')
          html = html.replace(re, () => {
            removed++
            return ''
          })
        }
        if (removed === 0) throw new Error('未能在正文中定位失效引用标记，请手动处理')
        await api('/api/chapters', {
          method: 'PATCH',
          body: JSON.stringify({ id: issue.chapterId, content: html }),
        })
        toast.success(`已移除 ${removed} 处失效引用标记`)
      } else {
        toast.error('该问题类型暂不支持一键修复，请按建议手动处理')
        return
      }
      await handleIssueStatus(issue.id, 'resolved')
    } catch (e: any) {
      toast.error(e.message || '修复失败')
    } finally {
      setFixingId(null)
    }
  }

  const handleNaturalize = async (mode: 'review' | 'rewrite') => {
    const cid = targetChapterId ?? chapterId
    if (!cid) {
      toast.error('请先在上方选择一个具体章节（去 AI 味改写需针对单章）')
      return
    }
    let contentToProcess = effectiveContent
    if (!contentToProcess?.trim()) {
      try {
        const fetched = await api<{ chapter: { content: string } }>(`/api/chapters?id=${cid}`)
        contentToProcess = fetched.chapter?.content || ''
      } catch {}
    }
    if (!contentToProcess?.trim()) {
      toast.error('所选章节暂无正文')
      return
    }
    setNatLoading(true)
    try {
      const r = await api<{ reply: string }>('/api/ai/naturalize', {
        method: 'POST',
        body: JSON.stringify({ text: contentToProcess, mode, novelId }),
      })
      if (mode === 'rewrite') {
        const origLines = htmlToPlainLines(contentToProcess)
        const originalText = origLines.join('\n')
        // 新协议：模型只输出「病灶句修改清单」，前端做精确替换——
        // 清单里没有的句子在代码层面保证逐字不变，从结构上杜绝标点规范化与文本漂移
        let edits: Array<{ original?: string; rewritten?: string }> = []
        const jsonMatch = r.reply.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0])
            if (Array.isArray(parsed)) edits = parsed
          } catch { }
        }
        if (edits.length === 0) {
          toast.info('本轮 AI 判定没有需要修改的病灶句（或返回格式异常），正文未改动')
          return
        }
        let text = originalText
        let applied = 0
        let skipped = 0
        for (const e of edits) {
          const o = (e.original || '').trim()
          const nw = typeof e.rewritten === 'string' ? e.rewritten.trim() : ''
          if (!o || !nw || o === nw) continue
          if (text.includes(o)) {
            text = text.replace(o, nw)
            applied++
          } else {
            // 宽松兜底：空白/全半角差异导致精确匹配失败时，允许空白差异的模糊匹配
            const esc = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ \u3000]+/g, '\\s*')
            const re = new RegExp(esc)
            if (re.test(text)) {
              text = text.replace(re, nw)
              applied++
            } else {
              skipped++
            }
          }
        }
        const nextLines = text.split('\n')
        setNatDiff({
          chapterId: cid,
          chapterTitle: targetChapter?.title || '当前章节',
          originalText,
          rewrittenText: text,
          ops: computeLineDiff(origLines, nextLines),
          applied,
          skipped,
        })
        toast.success(`已生成修改对比：定点应用 ${applied} 处${skipped ? `，${skipped} 处未匹配已跳过` : ''}，请确认是否替换原文`)
      } else {
        setNatResult(r.reply)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setNatLoading(false)
    }
  }

  const handleConfirmReplaceDiff = async () => {
    if (!natDiff) return
    setApplyingDiff(true)
    try {
      const html = plainToHtml(natDiff.rewrittenText)
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({ id: natDiff.chapterId, content: html }),
      })
      toast.success(`已确认修改并替换「${natDiff.chapterTitle}」正文`)
      setNatDiff(null)
      onChapterUpdated?.()
      if (natDiff.chapterId === chapterId && onJumpChapter) {
        onJumpChapter(natDiff.chapterId)
      }
    } catch (e: any) {
      toast.error(e.message || '替换失败')
    } finally {
      setApplyingDiff(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <ShieldAlert className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          长篇工具
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              长篇一致性与质量工作台
            </DialogTitle>
            <div className="flex items-center gap-2">
              <span
                className="text-xs text-muted-foreground"
                title="支持「全部文章」或「任一单章」；卷仅用于分组展示——AI 类操作（诊断/改写/查错）按单章执行，确定性巡检按全书执行"
              >
                作用范围：
              </span>
              <Select value={scope} onValueChange={(v) => { setScope(v); setNatDiff(null) }}>
                <SelectTrigger className="h-7 w-[200px] text-xs" title="支持「全部文章」或「任一单章」；卷仅用于分组，不可整体选择">
                  <SelectValue placeholder="选择章节或全书" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all" className="text-xs font-medium">
                    全部文章（全书所有章节）
                  </SelectItem>
                  {volumes.map((v) => (
                    <SelectGroup key={v.id}>
                      <SelectLabel className="text-[10px] text-muted-foreground">
                        {v.title}（卷不可整体选择，AI 操作按单章执行）
                      </SelectLabel>
                      {v.chapters.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.title}
                          {c.id === chapterId ? '（当前）' : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="timeline" className="gap-1.5 text-xs" title="维护事件时间锚点，自动注入 AI 上下文，防止续写时时间倒流">
              <Clock className="h-3.5 w-3.5" />
              时间线
            </TabsTrigger>
            <TabsTrigger value="foreshadowing" className="gap-1.5 text-xs" title="伏笔追踪：登记/推进/回收状态机，活跃伏笔自动注入 AI 上下文">
              <Anchor className="h-3.5 w-3.5" />
              伏笔
            </TabsTrigger>
            <TabsTrigger value="guard" className="gap-1.5 text-xs" title="巡检失效 @引用、重名设定、缺失摘要与逻辑冲突，问题可销账处理">
              <ShieldAlert className="h-3.5 w-3.5" />
              一致性守卫
            </TabsTrigger>
            <TabsTrigger value="ratio" className="gap-1.5 text-xs" title="发稿前终审：全书/单章 AI 采纳占比 + 整章去 AI 味诊断与带 diff 的改写">
              <Wand2 className="h-3.5 w-3.5" />
              发稿终审
            </TabsTrigger>
          </TabsList>

          {/* 1. 时间线 */}
          <TabsContent value="timeline" className="min-h-0 flex-1 overflow-y-auto space-y-4 pt-3">
            <div className="rounded-md border p-3 space-y-2 bg-muted/20">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  从章节摘要批量生成时间线草稿，勾选确认后入库（已导入过的章节自动跳过）
                </p>
                <Button size="sm" variant="outline" onClick={handleExtractTimeline} disabled={extractLoading}>
                  {extractLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  从章节摘要提取
                </Button>
              </div>
              {extractDrafts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {extractDrafts.map((d) => (
                      <label
                        key={d.chapterId}
                        className="flex items-start gap-2 text-xs rounded border p-2 cursor-pointer hover:bg-accent/40"
                      >
                        <input
                          type="checkbox"
                          checked={d.selected}
                          onChange={(e) =>
                            setExtractDrafts((prev) =>
                              prev.map((x) => (x.chapterId === d.chapterId ? { ...x, selected: e.target.checked } : x))
                            )
                          }
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {d.timeLabel}｜{d.eventTitle}
                          </div>
                          <div className="text-muted-foreground line-clamp-2">{d.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <Button size="sm" className="w-full" onClick={handleImportTimelineDrafts} disabled={extractSaving}>
                    {extractSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    导入选中事件（{extractDrafts.filter((d) => d.selected).length} 条）
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-md border p-3 bg-muted/20">
              <Input
                value={timeLabel}
                onChange={(e) => setTimeLabel(e.target.value)}
                placeholder="时间锚点（如：第一年·秋）"
                className="text-xs"
              />
              <Input
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="核心事件标题"
                className="text-xs sm:col-span-2"
              />
              <Textarea
                value={eventDesc}
                onChange={(e) => setEventDesc(e.target.value)}
                placeholder="补充说明（人物去向、伏笔状态等，可选）"
                rows={2}
                className="text-xs sm:col-span-3"
              />
              <div className="sm:col-span-3 flex justify-end">
                <Button size="sm" onClick={handleAddEvent} disabled={timelineLoading} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  添加时间锚点
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {events.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8">
                  暂无时间线事件，添加后会自动注入 AI 上下文防止时间倒流
                </p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="flex items-start justify-between gap-3 rounded-md border p-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{ev.timeLabel}</Badge>
                        <span className="font-medium">{ev.title}</span>
                      </div>
                      {ev.description && (
                        <p className="text-muted-foreground">{ev.description}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteEvent(ev.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* 1.5 伏笔追踪 */}
          <TabsContent value="foreshadowing" className="min-h-0 flex-1 overflow-y-auto space-y-3 pt-3">
            <ForeshadowingPanel novelId={novelId} />
          </TabsContent>

          {/* 2. 一致性守卫 */}
          <TabsContent value="guard" className="min-h-0 flex-1 overflow-y-auto space-y-3 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                检查失效 @ 引用、重名设定、缺失摘要及 AI 逻辑矛盾
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRunGuard(false)}
                  disabled={guardLoading}
                >
                  {guardLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  快速规则巡检
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleRunGuard(true)}
                  disabled={guardLoading}
                >
                  {guardLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  AI 深度查错
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {issues.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-10 flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
                  <span>暂无待处理的一致性冲突，点击上方按钮开始巡检</span>
                </div>
              ) : (
                issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`rounded-md border p-3 text-xs space-y-1.5 ${issue.status !== 'open' ? 'opacity-50' : ''
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            issue.severity === 'error'
                              ? 'destructive'
                              : issue.severity === 'warning'
                                ? 'default'
                                : 'secondary'
                          }
                        >
                          {issue.severity}
                        </Badge>
                        <span className="font-medium">{issue.title}</span>
                      </div>
                      {issue.status === 'open' && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {(issue.category === 'timeline' || issue.category === 'codex') && issue.chapterId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs text-indigo-600 dark:text-indigo-400"
                              title="缺失摘要：AI 生成并写回；失效引用：移除正文中的失效标记"
                              disabled={fixingId === issue.id}
                              onClick={() => handleFixIssue(issue)}
                            >
                              {fixingId === issue.id && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                              一键修复
                            </Button>
                          )}
                          {issue.chapterId && onJumpChapter && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs"
                              onClick={() => {
                                onJumpChapter(issue.chapterId)
                                setOpen(false)
                              }}
                            >
                              跳转章节
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => handleIssueStatus(issue.id, 'resolved')}
                          >
                            已解决
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => handleIssueStatus(issue.id, 'ignored')}
                          >
                            忽略
                          </Button>
                        </div>
                      )}
                    </div>
                    <p className="text-muted-foreground">{issue.detail}</p>
                    {issue.suggestion && (
                      <p className="text-indigo-600 dark:text-indigo-400">
                        建议：{issue.suggestion}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* 3. 发稿终审 */}
          <TabsContent value="ratio" className="min-h-0 flex-1 overflow-y-auto space-y-4 pt-3">
            <p className="text-xs text-muted-foreground rounded-md border p-2.5 bg-muted/20">
              <strong>发稿前终审：</strong>
              先看 AI 采纳占比，用「表达模式诊断」拿证据清单，需要时「按作者文风精修」并对比确认后替换。
              <strong className="text-foreground">诊断与改写是 LLM 操作，只能按单章执行</strong>
              （整章跑一遍，控制成本与质量）；全书排查请先用下方占比列表定位重灾区，点击章节名切换后再诊断。
              分工速查：改几句 → 编辑器内联菜单；整章重写 → AI 助手「润色」；查逻辑 → 一致性守卫。
            </p>

            {scope === 'all' ? (
              <div className="rounded-md border p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    全书各章 AI 采纳占比（按占比从高到低；<span className="text-amber-600 dark:text-amber-400">诊断/改写按单章执行——点击章节名切到该章后再操作</span>）
                  </span>
                  <Button size="sm" variant="outline" onClick={loadAllRatios} disabled={ratioListLoading}>
                    {ratioListLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    刷新全书统计
                  </Button>
                </div>
                {ratioList.length === 0 && !ratioListLoading && (
                  <p className="text-muted-foreground">
                    点击「刷新全书统计」开始逐章统计（确定性统计，零 AI 成本，只统计有正文的章节）
                  </p>
                )}
                {ratioList.length > 0 && (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {ratioList.map((r) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          className="w-48 truncate text-left hover:text-indigo-600 dark:hover:text-indigo-400"
                          title={`切到「${r.title}」查看详情`}
                          onClick={() => setScope(r.id)}
                        >
                          {r.title}
                        </button>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${r.aiRatio > 80 ? 'bg-red-500' : r.aiRatio > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${r.aiRatio}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-muted-foreground">{r.aiRatio}%</span>
                        <span className="w-24 text-right text-muted-foreground">AI {r.aiChars} 字</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {ratioData ? (
                  <div className="rounded-md border p-4 space-y-2 bg-muted/20 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        当前章节 AI 采纳占比：{ratioData.aiRatio}%
                      </span>
                      <span className="text-muted-foreground">
                        AI {ratioData.aiChars} 字 / 人工 {ratioData.humanChars} 字
                      </span>
                    </div>
                    <Progress value={ratioData.aiRatio} />
                    <p className="text-muted-foreground">
                      基于段落级 Provenance 溯源统计（AI 段落 {ratioData.aiParagraphs} 段，人工段落{' '}
                      {ratioData.humanParagraphs} 段）
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">所选章节暂无正文，无法统计占比</p>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleNaturalize('review')}
                    disabled={natLoading}
                  >
                    {natLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    表达模式诊断
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleNaturalize('rewrite')}
                    disabled={natLoading}
                  >
                    {natLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    按作者文风精修（生成对比）
                  </Button>
                </div>
              </>
            )}

            {natDiff && (
              <div className="rounded-[12px] border border-[var(--brand-line)] bg-card p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <div className="text-xs font-semibold flex items-center gap-2">
                    <span>修改对比：「{natDiff.chapterTitle}」</span>
                    <Badge variant="outline" className="text-[10px]">
                      {natDiff.applied != null
                        ? `定点修改 ${natDiff.applied} 处${natDiff.skipped ? `（${natDiff.skipped} 处未匹配跳过）` : ''}`
                        : `${natDiff.ops.filter((o) => o.type !== 'same').length} 处差异`}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={applyingDiff}
                      onClick={() => setNatDiff(null)}
                    >
                      放弃修改
                    </Button>
                    {natDiff.chapterId === chapterId && onInsertAiDraft && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={applyingDiff}
                        onClick={() => {
                          onInsertAiDraft(natDiff.rewrittenText)
                          setNatDiff(null)
                          setOpen(false)
                          toast.success('已作为待采纳草稿插入正文')
                        }}
                      >
                        插入为待采纳草稿
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white border-0"
                      disabled={applyingDiff}
                      onClick={handleConfirmReplaceDiff}
                    >
                      {applyingDiff && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      确认修改（替换正文）
                    </Button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1.5 text-xs leading-relaxed">
                  {natDiff.ops.map((op, idx) => (
                    <div
                      key={idx}
                      className={`px-2.5 py-1.5 rounded ${
                        op.type === 'del'
                          ? 'bg-red-500/10 text-red-700 dark:text-red-300 line-through'
                          : op.type === 'add'
                            ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-l-2 border-emerald-500'
                            : 'text-muted-foreground'
                      }`}
                    >
                      <span className="font-mono text-[10px] mr-1.5 opacity-70">
                        {op.type === 'del' ? '−' : op.type === 'add' ? '+' : ' '}
                      </span>
                      {op.text}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {natResult && (
              <div className="rounded-md border p-3 text-xs whitespace-pre-wrap leading-relaxed bg-background">
                {natResult}
              </div>
            )}
          </TabsContent>
        </Tabs>
        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          分工速查：改几句 → 编辑器内联菜单（润色/扩写/续写）；整章重写 → AI 助手「润色」；查逻辑、时间线、占比与发稿终审 → 本工作台。
        </p>
      </DialogContent>
    </Dialog>
  )
}
