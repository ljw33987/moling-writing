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
  Layers,
  Sparkles,
  Loader2,
  CheckCircle2,
  Trash2,
  Plus,
  Wand2,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Volume } from './editor-view'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'

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
  const [tab, setTab] = useState('preview')
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

  // 1. 上下文预检
  const [previewData, setPreviewData] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

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
  } | null>(null)
  const [natLoading, setNatLoading] = useState(false)
  const [applyingDiff, setApplyingDiff] = useState(false)

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true)
    try {
      const r = await api('/api/ai/preview', {
        method: 'POST',
        body: JSON.stringify({ novelId, chapterId: targetChapterId ?? chapterId }),
      })
      setPreviewData(r)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPreviewLoading(false)
    }
  }, [novelId, targetChapterId, chapterId])

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

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      if (tab === 'preview') void loadPreview()
      if (tab === 'timeline') void loadTimeline()
      if (tab === 'guard') void loadGuard()
      if (tab === 'ratio') void loadRatio()
    }, 0)
    return () => clearTimeout(timer)
  }, [open, tab, loadPreview, loadTimeline, loadGuard, loadRatio])

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
        body: JSON.stringify({ text: contentToProcess, mode }),
      })
      if (mode === 'rewrite') {
        const origLines = htmlToPlainLines(contentToProcess)
        const nextLines = r.reply
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
        setNatDiff({
          chapterId: cid,
          chapterTitle: targetChapter?.title || '当前章节',
          originalText: origLines.join('\n'),
          rewrittenText: r.reply,
          ops: computeLineDiff(origLines, nextLines),
        })
        toast.success('已生成修改对比，请确认是否替换原文')
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
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              长篇一致性与质量工作台
            </DialogTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">作用范围：</span>
              <Select value={scope} onValueChange={(v) => { setScope(v); setNatDiff(null) }}>
                <SelectTrigger className="h-7 w-[200px] text-xs">
                  <SelectValue placeholder="选择章节或全书" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all" className="text-xs font-medium">
                    全部文章（全书所有章节）
                  </SelectItem>
                  {allChapters.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.title}
                      {c.id === chapterId ? '（当前）' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="preview" className="gap-1.5 text-xs">
              <Layers className="h-3.5 w-3.5" />
              上下文预检
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1.5 text-xs">
              <Clock className="h-3.5 w-3.5" />
              时间线
            </TabsTrigger>
            <TabsTrigger value="guard" className="gap-1.5 text-xs">
              <ShieldAlert className="h-3.5 w-3.5" />
              一致性守卫
            </TabsTrigger>
            <TabsTrigger value="ratio" className="gap-1.5 text-xs">
              <Wand2 className="h-3.5 w-3.5" />
              AI 占比与去味
            </TabsTrigger>
          </TabsList>

          {/* 1. 上下文预检 */}
          <TabsContent value="preview" className="flex-1 overflow-y-auto space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                展示 AI 生成前实际装配的分层上下文与 Token 预算占用
              </p>
              <Button size="sm" variant="outline" onClick={loadPreview} disabled={previewLoading}>
                {previewLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                刷新预检
              </Button>
            </div>
            {previewData && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      总装配：<strong>{previewData.totalTokens}</strong> / {previewData.budgetTokens} tokens
                    </span>
                    <Badge variant={previewData.preflight?.status === 'ready' ? 'secondary' : 'destructive'}>
                      {previewData.preflight?.status === 'ready' ? '预检通过' : '需注意'}
                    </Badge>
                  </div>
                  <Progress
                    value={Math.min(100, Math.round((previewData.totalTokens / Math.max(1, previewData.budgetTokens)) * 100))}
                  />
                  {previewData.preflight?.warnings?.map((w: string, i: number) => (
                    <p key={i} className="text-xs text-amber-600 dark:text-amber-400">
                      • {w}
                    </p>
                  ))}
                </div>

                <div className="space-y-2">
                  {previewData.layers?.map((layer: any) => (
                    <div key={layer.key} className="rounded-md border p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {layer.label}（{layer.itemCount} 项）
                        </span>
                        <div className="flex items-center gap-2">
                          {layer.trimmed && <Badge variant="outline">已按预算裁剪</Badge>}
                          <span className="text-muted-foreground">{layer.tokens} tokens</span>
                        </div>
                      </div>
                      <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                        {layer.preview}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* 2. 时间线 */}
          <TabsContent value="timeline" className="flex-1 overflow-y-auto space-y-4 pt-3">
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

          {/* 3. 一致性守卫 */}
          <TabsContent value="guard" className="flex-1 overflow-y-auto space-y-3 pt-3">
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

          {/* 4. AI 占比与去 AI 味 */}
          <TabsContent value="ratio" className="flex-1 overflow-y-auto space-y-4 pt-3">
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
              <p className="text-xs text-muted-foreground">请先选择一个章节</p>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleNaturalize('review')}
                disabled={natLoading}
              >
                {natLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                AI 味诊断
              </Button>
              <Button
                size="sm"
                onClick={() => handleNaturalize('rewrite')}
                disabled={natLoading}
              >
                {natLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                一键去 AI 味（生成修改对比）
              </Button>
            </div>

            {natDiff && (
              <div className="rounded-[12px] border border-[var(--brand-line)] bg-card p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <div className="text-xs font-semibold flex items-center gap-2">
                    <span>修改对比：「{natDiff.chapterTitle}」</span>
                    <Badge variant="outline" className="text-[10px]">
                      {natDiff.ops.filter((o) => o.type !== 'same').length} 处差异
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
      </DialogContent>
    </Dialog>
  )
}
