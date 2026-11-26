'use client'

import { useEffect, useState, useCallback } from 'react'
import { api, formatTime } from '@/lib/helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Zap,
  Pause,
  Play,
  RefreshCw,
  Loader2,
  Clock,
  Sparkles,
  Settings2,
  CheckCircle2,
  AlertCircle,
  TimerReset,
} from 'lucide-react'
import { toast } from 'sonner'

interface AutoSerialTask {
  id: string
  novelId: string
  enabled: boolean
  intervalMin: number
  targetWords: number
  lastRunAt: string | null
  nextRunAt: string | null
  status: string
  totalGenerated: number
  lastError: string | null
  plotDirection: string | null
}

interface Props {
  novelId: string
  onChapterCreated?: (chapterId?: string) => void
}

export function AutoSerialPanel({ novelId, onChapterCreated }: Props) {
  const [task, setTask] = useState<AutoSerialTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [intervalMin, setIntervalMin] = useState(60)
  const [targetWords, setTargetWords] = useState(2000)
  const [plotDirection, setPlotDirection] = useState('')
  const [toggling, setToggling] = useState(false)
  const [runningNow, setRunningNow] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api<{ task: AutoSerialTask }>(`/api/auto-serial?novelId=${novelId}`)
      setTask(r.task)
      setIntervalMin(r.task.intervalMin)
      setTargetWords(r.task.targetWords)
      setPlotDirection(r.task.plotDirection || '')
    } catch (e: any) {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }, [novelId])

  useEffect(() => {
    load()
    // 每 10 秒刷新一次任务状态
    const i = setInterval(load, 10000)
    return () => clearInterval(i)
  }, [load])

  const handleSave = async () => {
    setToggling(true)
    try {
      await api('/api/auto-serial', {
        method: 'POST',
        body: JSON.stringify({
          novelId,
          intervalMin: Number(intervalMin),
          targetWords: Number(targetWords),
          plotDirection: plotDirection.trim() || null,
        }),
      })
      toast.success('设置已保存')
      setOpen(false)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setToggling(false)
    }
  }

  const handleToggle = async () => {
    if (!task) return
    setToggling(true)
    try {
      const newEnabled = !task.enabled
      await api('/api/auto-serial', {
        method: 'POST',
        body: JSON.stringify({ novelId, enabled: newEnabled }),
      })
      toast.success(newEnabled ? '自动连载已开启' : '已暂停')
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setToggling(false)
    }
  }

  const handleRunNow = async () => {
    if (!task) return
    setRunningNow(true)
    try {
      const r = await api<{ ok: boolean; chapter?: { id: string; title: string }; message?: string }>(
        `/api/auto-serial?action=run-now&novelId=${novelId}`,
        { method: 'PATCH' }
      )
      toast.success(r.message || '已生成新章节')
      load()
      onChapterCreated?.(r.chapter?.id)
    } catch (e: any) {
      toast.error(e.message || '生成失败')
    } finally {
      setRunningNow(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        加载自动连载...
      </div>
    )
  }

  if (!task) return null

  const statusConfig: Record<string, { label: string; color: string; dot: string; icon: any }> = {
    idle: { label: '空闲', color: 'text-slate-500', dot: 'bg-slate-400', icon: CheckCircle2 },
    running: { label: '生成中', color: 'text-blue-500', dot: 'bg-blue-500 animate-pulse', icon: Loader2 },
    paused: { label: '已暂停', color: 'text-amber-500', dot: 'bg-amber-400', icon: Pause },
    error: { label: '错误', color: 'text-red-500', dot: 'bg-red-500', icon: AlertCircle },
  }
  const status = statusConfig[task.status] || statusConfig.idle
  const StatusIcon = status.icon

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1.5 cursor-help ${status.color}`}
          >
            {task.status === 'running' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <StatusIcon className="w-3 h-3" />
            )}
            AI 连载：{status.label}
            {task.totalGenerated > 0 && <span className="text-muted-foreground">· 已生成 {task.totalGenerated} 章</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
          {task.lastError
            ? `上次生成出错：${task.lastError}`
            : '自动连载状态：开启后将按设定间隔，结合简介、大纲、人设和最近3章自动续写并保存新章节。'}
        </TooltipContent>
      </Tooltip>

      {/* 控制按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={task.enabled ? 'destructive' : 'default'}
            className="h-7 gap-1.5 text-xs"
            disabled={toggling}
            onClick={handleToggle}
          >
            {toggling ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : task.enabled ? (
              <Pause className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {task.enabled ? '暂停' : '开启'}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {task.enabled
            ? '暂停定时自动连载（不再按间隔自动生成新章）'
            : `开启定时自动连载：每 ${intervalMin} 分钟自动生成一章约 ${targetWords} 字的新章节`}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            disabled={runningNow || task.status === 'running'}
            onClick={handleRunNow}
          >
            {runningNow ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {runningNow ? '生成中...' : '立即生成'}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          立即基于本书大纲、角色设定和最近3章内容，自动续写并新增下一章
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <Settings2 className="w-3.5 h-3.5" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            配置自动连载的生成间隔、每章目标字数与剧情走向提示
          </TooltipContent>
        </Tooltip>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TimerReset className="w-4 h-4 text-teal-" />
              自动连载设置
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>生成间隔（分钟）</Label>
                <Input
                  type="number"
                  min={5}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">最小 5 分钟</p>
              </div>
              <div className="space-y-2">
                <Label>每章字数目标</Label>
                <Input
                  type="number"
                  min={500}
                  step={500}
                  value={targetWords}
                  onChange={(e) => setTargetWords(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">建议 1500-3000</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>剧情走向提示（可选）</Label>
              <Textarea
                value={plotDirection}
                onChange={(e) => setPlotDirection(e.target.value)}
                placeholder="例：主角即将遭遇强敌，需要描写一场苦战；或：本卷收尾，需要解决伏笔"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                AI 会根据此提示 + 大纲 + 前文，自动生成下一章
              </p>
            </div>

            {task.lastRunAt && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="w-3 h-3" />
                上次生成：{formatTime(task.lastRunAt)}
                {task.nextRunAt && task.enabled && (
                  <>
                    <span>·</span>
                    <span>下次：{formatTime(task.nextRunAt)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={toggling} className="gap-1.5">
              {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              保存设置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
