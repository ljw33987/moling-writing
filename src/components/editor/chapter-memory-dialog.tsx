'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MAX_CHAPTER_DRAFT_LENGTH } from '@/lib/ai-writing-intent'
import { api, stripHtml } from '@/lib/helpers'
import { getStoredSkillIds } from '@/lib/writing-skills'
import type { ExtractedChapterMemory } from '@/lib/multi-agent-writing'
import { toast } from 'sonner'

interface Props {
  novelId: string
  chapter: { id: string; title: string; content: string; summary: string | null }
  onClose: () => void
  onSaved: (summary?: string) => void
}

export function ChapterMemoryDialog({ novelId, chapter, onClose, onSaved }: Props) {
  const [memory, setMemory] = useState<ExtractedChapterMemory | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'extract' | 'save' | null>(null)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const groups = memory ? [
    { key: 'characters', title: '角色', entries: memory.characters.map((entry) => ({
      name: entry.name, description: [entry.background, entry.personality, entry.relations, entry.abilities, entry.appearance].filter(Boolean).join(' · '),
    })) },
    { key: 'worldviews', title: '世界观', entries: memory.worldviews.map((entry) => ({ name: entry.name, description: entry.description })) },
    { key: 'items', title: '道具与功法', entries: memory.items.map((entry) => ({
      name: entry.name, description: [entry.attributes, entry.effect].filter(Boolean).join(' · '),
    })) },
    { key: 'timelineEvents', title: '时间线', entries: memory.timelineEvents.map((entry) => ({
      name: entry.title, description: [entry.timeLabel, entry.description].filter(Boolean).join(' · '),
    })) },
  ] : []

  async function extract() {
    if (inFlight.current) return
    const draftText = stripHtml(chapter.content)
    if (draftText.length < 50 || draftText.length > MAX_CHAPTER_DRAFT_LENGTH) {
      setError(draftText.length < 50 ? '正文至少需要 50 字。' : '正文超出单次提取范围。')
      return
    }

    inFlight.current = true
    setBusy('extract')
    setError('')
    try {
      const result = await api<{ structuredData: ExtractedChapterMemory | null }>('/api/ai/multi-agent', {
        method: 'POST',
        body: JSON.stringify({
          agentId: 'extractor', novelId, chapterId: chapter.id, draftText, skillIds: getStoredSkillIds(novelId),
        }),
      })
      if (!result.structuredData) throw new Error('暂未提取出可写入的内容，请重试')
      setMemory(result.structuredData)
      setSelected(new Set())
    } catch (error) {
      setError(error instanceof Error ? error.message : '提取失败，请重试')
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function save() {
    if (!memory || !selected.size || inFlight.current) return
    const pick = <T,>(entries: T[], group: string) => entries.filter((_, index) => selected.has(`${group}:${index}`))

    inFlight.current = true
    setBusy('save')
    setError('')
    try {
      const result = await api<{ saved: number; skipped: number; summary?: string }>('/api/ai/multi-agent', {
        method: 'PATCH',
        body: JSON.stringify({
          novelId,
          chapterId: chapter.id,
          expectedSummary: chapter.summary,
          summary: selected.has('summary') ? memory.summary : '',
          characters: pick(memory.characters, 'characters'),
          worldviews: pick(memory.worldviews, 'worldviews'),
          items: pick(memory.items, 'items'),
          timelineEvents: pick(memory.timelineEvents, 'timelineEvents'),
        }),
      })
      toast.success(`已写入 ${result.saved} 项${result.skipped ? `，跳过 ${result.skipped} 项已有内容` : ''}`)
      onSaved(result.summary)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : '写入失败，请重试')
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  function toggle(key: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>从本章提取设定</DialogTitle>
          <DialogDescription>来源章节「{chapter.title}」。勾选核对过的内容后写入作品。</DialogDescription>
        </DialogHeader>

        {memory && (
          <fieldset disabled={!!busy} className="min-w-0 space-y-4 text-sm">
            {memory.summary && (
              <label className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox checked={selected.has('summary')} onCheckedChange={(checked) => toggle('summary', checked === true)} />
                <span className="min-w-0 break-words">
                  <span className="block font-medium">{chapter.summary ? '替换已有章摘要' : '写入章摘要'}</span>
                  <span className="text-muted-foreground">{memory.summary}</span>
                </span>
              </label>
            )}
            {groups.filter((group) => group.entries.length).map((group) => (
              <div key={group.key} className="space-y-1.5">
                <h3 className="font-medium">{group.title}</h3>
                {group.entries.map((entry, index) => {
                  const key = `${group.key}:${index}`
                  return (
                    <label key={key} className="flex items-start gap-2 rounded-md border p-2">
                      <Checkbox checked={selected.has(key)} onCheckedChange={(checked) => toggle(key, checked === true)} />
                      <span className="min-w-0 break-words">
                        <span className="block font-medium">{entry.name}</span>
                        {entry.description && <span className="text-muted-foreground">{entry.description}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            ))}
            {memory.foreshadowing.length > 0 && (
              <div className="space-y-1 text-muted-foreground">
                <h3 className="font-medium text-foreground">伏笔备忘（可复制）</h3>
                {memory.foreshadowing.map((entry, index) => (
                  <p key={index}>{entry.status === 'new' ? '新伏笔' : '已回收'} · {entry.content}</p>
                ))}
              </div>
            )}
            {!memory.summary && groups.every((group) => group.entries.length === 0) && (
              <p className="text-muted-foreground">本章暂无可入库的设定。</p>
            )}
          </fieldset>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={onClose}>关闭</Button>
          <Button variant={memory ? 'outline' : 'default'} disabled={!!busy} onClick={() => void extract()}>
            {busy === 'extract' ? '正在提取…' : memory ? '重新提取' : '开始提取'}
          </Button>
          {memory && (
            <Button disabled={!!busy || !selected.size} onClick={() => void save()}>
              {busy === 'save' ? '正在写入…' : `写入所选内容（${selected.size}）`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
