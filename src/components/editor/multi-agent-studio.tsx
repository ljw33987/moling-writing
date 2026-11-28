'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CONTINUATION_CONTEXT_LENGTH } from '@/lib/ai-writing-intent'
import { api, stripHtml } from '@/lib/helpers'
import { MarkdownRenderer } from '@/components/ai/markdown-renderer'
import { Square } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  open: boolean
  novelId: string
  chapterId: string
  chapterTitle: string
  chapterContent: string
  initialGoal: string
  modelId: string
  writingStyleId: string | null
  skillIds?: string[]
  onClose: () => void
  onPreview: (text: string, chapterId: string, original: string) => void
}

export function DeepChapterDialog({
  open, novelId, chapterId, chapterTitle, chapterContent, initialGoal, modelId, writingStyleId,
  skillIds, onClose, onPreview,
}: Props) {
  const [original] = useState(chapterContent)
  const [goal, setGoal] = useState(initialGoal)
  const [targetWords, setTargetWords] = useState('2000')
  const [outline, setOutline] = useState('')
  const [audit, setAudit] = useState('')
  const [auditPassed, setAuditPassed] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [appliedSkills, setAppliedSkills] = useState<string[]>([])
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  async function callStep(
    agentId: 'composer' | 'auditor' | 'writer' | 'actor',
    signal: AbortSignal,
    upstreamOutputs?: { composer?: string; auditor?: string },
    draftText?: string,
  ) {
    const result = await api<{ output: string; appliedSkills: string[] }>('/api/ai/multi-agent', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        agentId, novelId, chapterId, userGoal: goal.trim(), targetWords: Number(targetWords),
        modelId, writingStyleId, skillIds, upstreamOutputs, draftText,
      }),
    })
    if (!signal.aborted && result.appliedSkills.length) {
      setAppliedSkills((previous) => Array.from(new Set([...previous, ...result.appliedSkills])))
    }
    return result.output
  }

  async function runStep(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(label)
    setError('')
    try {
      await work(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : '当前步骤失败，请重试')
      }
    } finally {
      if (request.current === controller) request.current = null
      setBusy('')
    }
  }

  function pauseCurrentStep() {
    if (!request.current) return
    request.current.abort()
    request.current = null
    setBusy('')
    setError('已暂停当前步骤。已有章纲、审查结果和草稿会保留。')
  }

  async function checkOutline(text: string, signal: AbortSignal) {
    setBusy('检查章纲一致性')
    const result = await callStep('auditor', signal, { composer: text })
    if (signal.aborted) return
    setAudit(result)
    const conclusion = result.trim().split('\n')[0].replace(/[*#\x60]/g, '').trim()
    setAuditPassed(/^结论\s*[:：]\s*通过[。.]?$/.test(conclusion))
  }

  function invalidateAudit() {
    setAudit('')
    setAuditPassed(false)
    setDraft('')
  }

  function generateOutline() {
    invalidateAudit()
    setAppliedSkills([])
    void runStep('生成章纲', async (signal) => {
      const result = await callStep('composer', signal, undefined, stripHtml(original).slice(-CONTINUATION_CONTEXT_LENGTH))
      if (signal.aborted) return
      setOutline(result)
      await checkOutline(result, signal)
    })
  }

  function generateDraft() {
    void runStep('生成正文', async (signal) => {
      const result = await callStep('writer', signal, { composer: outline, auditor: audit })
      if (!signal.aborted) setDraft(result)
    })
  }

  function refineDraft() {
    void runStep('精修正文', async (signal) => {
      const result = await callStep('actor', signal, undefined, draft)
      if (signal.aborted) return
      if (result.trim().length < draft.trim().length * 0.6) {
        throw new Error('精修结果过短，已保留原草稿。')
      }
      setDraft(result)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>深度成章</DialogTitle>
          <DialogDescription>
            「{chapterTitle}」 · 用于关键章节。先生成章纲并检查设定、动机和时间线，通过后再写正文，最后可选精修。
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={!!busy} className="min-w-0 space-y-3">
          <label className="block space-y-1 text-sm font-medium">
            <span>本章目标</span>
            <Textarea rows={3} value={goal} onChange={(event) => {
              setGoal(event.target.value)
              invalidateAudit()
            }} placeholder="这一章要发生什么？" />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm font-medium">
              <span>目标字数</span>
              <Input className="w-28" type="number" min={800} max={6000} step={100} value={targetWords} onChange={(event) => {
                setTargetWords(event.target.value)
                invalidateAudit()
              }} />
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button onClick={generateOutline} disabled={!goal.trim()}>
                    {outline ? '重做章纲' : '生成并检查章纲'}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 leading-relaxed">
                根据本章目标生成分场章纲，并自动检查设定、人物动机和时间线。检查通过前不会生成正文。
              </TooltipContent>
            </Tooltip>
          </div>

          {outline && (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm font-medium">
                <span>章纲</span>
                <Textarea rows={6} value={outline} onChange={(event) => {
                  setOutline(event.target.value)
                  invalidateAudit()
                }} />
              </label>
              {audit && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <p className="mb-2 font-medium">{auditPassed ? '一致性检查通过' : '请按检查意见修改章纲，再重新检查'}</p>
                  <MarkdownRenderer content={audit} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button variant="outline" disabled={!outline.trim() || !goal.trim()} onClick={() => {
                        invalidateAudit()
                        void runStep('检查章纲一致性', (signal) => checkOutline(outline, signal))
                      }}>重新检查章纲</Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72 leading-relaxed">
                    修改章纲后重新核对作品设定、人物信息边界、动机和时间顺序。
                  </TooltipContent>
                </Tooltip>
                {auditPassed && !draft && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={generateDraft}>确认章纲并生成正文</Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-72 leading-relaxed">
                      按已通过检查的章纲生成完整正文。生成结果先保留为草稿，不会直接覆盖章节。
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          )}

          {draft && (
            <div className="space-y-2">
              <div className="max-h-64 overflow-y-auto rounded-md border p-3">
                <MarkdownRenderer content={draft} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" onClick={refineDraft}>精修正文</Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72 leading-relaxed">
                    保留剧情和人物，对草稿的生硬表达、节奏与口吻做一次精修。
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => onPreview(draft, chapterId, original)}>预览写回</Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72 leading-relaxed">
                    对比当前正文和生成草稿，确认后才会替换当前章节。
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </fieldset>

        {busy && <p role="status" className="text-sm text-muted-foreground">{busy}…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {appliedSkills.length > 0 && <p className="text-xs text-muted-foreground">已用技能 · {appliedSkills.join('、')}</p>}
        <DialogFooter>
          {busy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="destructive" onClick={pauseCurrentStep}>
                  <Square className="mr-1 h-3.5 w-3.5 fill-current" />
                  暂停生成
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 leading-relaxed">
                中断当前步骤，已完成的章纲、检查结果和草稿会继续保留。
              </TooltipContent>
            </Tooltip>
          )}
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
