'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Bold,
  Italic,
  Heading,
  Quote,
  List,
  Sparkles,
  Wand2,
  Loader2,
  FileText,
  RotateCcw,
  Indent,
  AlignJustify,
  Undo2,
  Redo2,
} from 'lucide-react'
import { api, CHAPTER_STATUS } from '@/lib/helpers'
import type { Chapter, NovelDetail } from './editor-view'
import { toast } from 'sonner'
import {
  NovelTiptapEditor,
  type NovelTiptapHandle,
} from './novel-tiptap-editor'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Label } from '@/components/ui/label'
import type { RecoveryDraft } from '@/hooks/use-autosave'

interface Props {
  chapter: Chapter | null
  novel: NovelDetail
  onContentChange: (content: string) => void
  onTitleChange: (title: string) => void
  onStatusChange: (status: string) => void
  editorMode: 'normal' | 'focus' | 'typewriter'
  onInsertText: (text: string) => void
  onManualSave?: () => void
  recoveryDraft?: RecoveryDraft | null
  onAcceptRecovery?: () => void
  onDismissRecovery?: () => void
  tiptapRef?: React.RefObject<NovelTiptapHandle | null>
}

export function EditorPanel({
  chapter,
  novel,
  onContentChange,
  onTitleChange,
  onStatusChange,
  editorMode,
  onManualSave,
  recoveryDraft,
  onAcceptRecovery,
  onDismissRecovery,
  tiptapRef: externalTiptapRef,
}: Props) {
  const internalTiptapRef = useRef<NovelTiptapHandle | null>(null)
  const tiptapRef = externalTiptapRef ?? internalTiptapRef
  const generation = useRef<AbortController | null>(null)
  useEffect(() => () => generation.current?.abort(), [])

  const [selectedText, setSelectedText] = useState('')
  const [inlineMenuOpen, setInlineMenuOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [genChapterOpen, setGenChapterOpen] = useState(false)
  const [coreEvent, setCoreEvent] = useState('')
  const [indent, setIndent] = useState(true)
  const [fontSize, setFontSize] = useState(17)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // 内联 AI 操作（润色 / 扩写 / 缩写 / 续写 / 转文风）
  const handleInlineAI = async (preset: string, targetStyle?: string) => {
    const editor = tiptapRef.current
    if (!selectedText || !editor || aiLoading) return
    setAiLoading(true)
    setInlineMenuOpen(false)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'edit',
          preset,
          message: selectedText,
          targetStyle,
          novelId: novel.id,
          chapterId: chapter?.id,
        }),
      })
      if (tiptapRef.current !== editor) return
      editor.replaceSelection(r.reply)
      toast.success('已应用 AI 修改（Ctrl+Z 可整段撤销）')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAiLoading(false)
    }
  }

  // 一键生成整章（流式写入 AiDraft 待采纳容器，不直接覆盖正文）
  const handleGenerateChapter = async () => {
    if (!coreEvent.trim() || !chapter) {
      toast.error('请填写核心事件')
      return
    }
    const editor = tiptapRef.current
    if (!editor || generation.current || aiLoading) return
    const request = new AbortController()
    generation.current = request
    setAiLoading(true)
    setGenChapterOpen(false)
    const runId = `ch-${Date.now()}`
    editor.startAiDraftStream(runId)

    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          preset: 'chapter_gen',
          message: `请根据以下核心事件生成完整章节：${coreEvent}`,
          novelId: novel.id,
          chapterId: chapter.id,
        }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `请求失败 (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            if (parsed.error) throw new Error(parsed.error)
            const chunk = parsed.text || parsed.content || parsed.delta || ''
            if (chunk && !request.signal.aborted && tiptapRef.current === editor) editor.appendAiDraftChunk(chunk)
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }

      if (request.signal.aborted || tiptapRef.current !== editor) return
      editor.finishAiDraftStream()
      toast.success('AI 草稿已生成，请在正文区点击「采纳」或「丢弃」')
      setCoreEvent('')
    } catch (e: any) {
      if (request.signal.aborted || tiptapRef.current !== editor) return
      editor.finishAiDraftStream()
      toast.error(e.message || '生成失败')
    } finally {
      generation.current = null
      setAiLoading(false)
    }
  }

  if (!chapter) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground">
        <FileText className="w-12 h-12 mb-3 opacity-40" />
        <p>从左侧选择一个章节开始创作</p>
        <p className="text-xs mt-1">或新建一个章节</p>
      </div>
    )
  }

  const status = CHAPTER_STATUS[chapter.status] || CHAPTER_STATUS.draft

  const currentVolume = novel.volumes.find((v) => v.id === chapter.volumeId)

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* 本地离线草稿恢复提示 */}
      {recoveryDraft && recoveryDraft.chapterId === chapter.id && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span>
              检测到本地有未同步的离线草稿（保存于{' '}
              {new Date(recoveryDraft.at).toLocaleTimeString()}），是否恢复？
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onDismissRecovery}>
              忽略
            </Button>
            <Button size="sm" className="h-6 text-xs" onClick={onAcceptRecovery}>
              恢复草稿
            </Button>
          </div>
        </div>
      )}

      {/* 顶部章节标题与格式工具栏（严格对齐 Studio Zero 设计稿） */}
      <div className="bg-card border-b border-border px-4 sm:px-7 pt-3.5 shrink-0">
        <div className="max-w-[740px] mx-auto flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <Input
              value={chapter.title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="border-0 px-0 h-auto text-[22px] font-bold tracking-tight focus-visible:ring-0 bg-transparent shadow-none"
              placeholder="章节标题"
            />
            <div className="flex items-center gap-2 mt-1 text-[11.5px] text-muted-foreground">
              {currentVolume && <span>{currentVolume.title}</span>}
              {currentVolume && <span>·</span>}
              <span className="tnum">{chapter.words.toLocaleString()} 字</span>
              {chapter.words > 0 && (
                <>
                  <span>·</span>
                  <span>约 {Math.ceil(chapter.words / 400)} 分钟阅读</span>
                </>
              )}
              {aiLoading && (
                <span className="text-primary flex items-center gap-1 ml-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  AI 写入草稿中...
                </span>
              )}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0 rounded-[9px] text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(CHAPTER_STATUS).map(([k, v]) => (
                <DropdownMenuItem key={k} onClick={() => onStatusChange(k)}>
                  <span className={`w-1.5 h-1.5 rounded-full ${v.dot} mr-2`} />
                  {v.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover open={genChapterOpen} onOpenChange={setGenChapterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 shrink-0 rounded-[9px] text-xs bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] hover:opacity-95 text-white border-0 shadow-xs"
                disabled={aiLoading}
              >
                {aiLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                一键生成
              </Button>
            </PopoverTrigger>
          <PopoverContent className="w-96" align="end">
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">核心事件 *</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  AI 将以「待采纳草稿」形式流式写入正文区，不会覆盖已有内容
                </p>
              </div>
              <Textarea
                value={coreEvent}
                onChange={(e) => setCoreEvent(e.target.value)}
                placeholder="例：主角在森林中遭遇追杀，觉醒血脉力量反杀敌人，但被神秘少女目睹"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGenChapterOpen(false)}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleGenerateChapter}
                  disabled={aiLoading}
                  className="gap-1.5"
                >
                  {aiLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  生成草稿
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

        {/* 格式工具栏 */}
        <div className="max-w-[740px] mx-auto flex flex-wrap items-center gap-1 mt-3 pb-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[7px]"
            disabled={!canUndo}
            onClick={() => tiptapRef.current?.undo()}
            title="撤销上一步 (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[7px]"
            disabled={!canRedo}
            onClick={() => tiptapRef.current?.redo()}
            title="重做 / 恢复 (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[7px]"
            onClick={() => tiptapRef.current?.toggleBold()}
            title="粗体 (Ctrl+B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[7px]"
            onClick={() => tiptapRef.current?.toggleItalic()}
            title="斜体 (Ctrl+I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 rounded-[7px]"
            onClick={() => tiptapRef.current?.toggleHeading()}
            title="小节标题"
          >
            <Heading className="w-3 h-3" />
            <span>小节标题</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 rounded-[7px]"
            onClick={() => tiptapRef.current?.toggleBlockquote()}
            title="引用"
          >
            <Quote className="w-3 h-3" />
            <span>引用</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 rounded-[7px]"
            onClick={() => tiptapRef.current?.toggleBulletList()}
            title="列表"
          >
            <List className="w-3 h-3" />
            <span>列表</span>
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2.5 text-xs gap-1 rounded-[7px] ${
              indent
                ? 'bg-[var(--brand-soft)] text-[var(--brand-ink)] font-medium border border-[var(--brand-line)]'
                : 'border border-border'
            }`}
            onClick={() => setIndent((v) => !v)}
            title="切换首行缩进两字"
          >
            <Indent className="w-3 h-3" />
            <span>首行缩进</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs rounded-[7px] tnum"
            onClick={() => setFontSize((s) => (s === 15 ? 17 : s === 17 ? 19 : 15))}
            title="切换正文字号"
          >
            {fontSize}px
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs gap-1 rounded-[7px]"
            onClick={() => {
              tiptapRef.current?.autoFormat()
              toast.success('已完成一键排版（清理空行与多余空格）')
            }}
            title="一键清理多余空行与段首空格"
          >
            <AlignJustify className="w-3 h-3" />
            <span>一键排版</span>
          </Button>

          <span className="ml-auto text-[11px] text-muted-foreground hidden sm:inline">
            输入 @ 引用设定
          </span>
        </div>
      </div>

      {/* Tiptap 写作引擎 */}
      <div className="flex-1 overflow-hidden relative">
        <NovelTiptapEditor
          ref={tiptapRef}
          novelId={novel.id}
          chapterId={chapter.id}
          content={chapter.content}
          editorMode={editorMode}
          indent={indent}
          fontSize={fontSize}
          onUpdate={(html) => onContentChange(html)}
          onSelectionChange={(text) => {
            setSelectedText(text)
            setInlineMenuOpen(!!text)
          }}
          onHistoryChange={(u, r) => {
            setCanUndo(u)
            setCanRedo(r)
          }}
          onSaveShortcut={onManualSave}
        />

        {/* 内联 AI 悬浮条（深色胶囊直达操作，不遮挡正文） */}
        {selectedText && inlineMenuOpen && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 px-1.5 py-1 rounded-[10px] bg-[#1B1B24] dark:bg-[#262A36] text-white border border-white/10 shadow-xl">
            <button
              type="button"
              disabled={aiLoading}
              onClick={() => handleInlineAI('polish')}
              className="h-7 px-2.5 rounded-[7px] text-xs font-medium hover:bg-white/10 inline-flex items-center gap-1 text-[#C3C6FF]"
            >
              {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              润色
            </button>
            <button
              type="button"
              disabled={aiLoading}
              onClick={() => handleInlineAI('expand')}
              className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10"
            >
              扩写
            </button>
            <button
              type="button"
              disabled={aiLoading}
              onClick={() => handleInlineAI('shorten')}
              className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10"
            >
              缩写
            </button>
            <button
              type="button"
              disabled={aiLoading}
              onClick={() => handleInlineAI('continue')}
              className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10"
            >
              续写
            </button>
            <span className="w-px h-4 bg-white/15 mx-0.5" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={aiLoading}
                  className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10"
                >
                  转文风
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onClick={() => handleInlineAI('style_change', '古风')}>
                  转古风文风
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleInlineAI('style_change', '科幻')}>
                  转科幻文风
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
