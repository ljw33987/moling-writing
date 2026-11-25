'use client'

import { useRef, useState } from 'react'
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

  const [selectedText, setSelectedText] = useState('')
  const [inlineMenuOpen, setInlineMenuOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [genChapterOpen, setGenChapterOpen] = useState(false)
  const [coreEvent, setCoreEvent] = useState('')
  const [indent, setIndent] = useState(true)
  const [fontSize, setFontSize] = useState(17)

  // 内联 AI 操作（润色 / 扩写 / 缩写 / 续写 / 转文风）
  const handleInlineAI = async (preset: string, targetStyle?: string) => {
    if (!selectedText) return
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
      tiptapRef.current?.replaceSelection(r.reply)
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
    setAiLoading(true)
    setGenChapterOpen(false)
    const runId = `ch-${Date.now()}`
    tiptapRef.current?.startAiDraftStream(runId)

    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
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
            if (chunk) tiptapRef.current?.appendAiDraftChunk(chunk)
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }

      tiptapRef.current?.finishAiDraftStream()
      // 同步保存章节摘要
      api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({ id: chapter.id, summary: coreEvent }),
      }).catch(() => {})
      toast.success('AI 草稿已生成，请在正文区点击「采纳」或「丢弃」')
      setCoreEvent('')
    } catch (e: any) {
      tiptapRef.current?.finishAiDraftStream()
      toast.error(e.message || '生成失败')
    } finally {
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

      {/* 顶部章节信息 */}
      <div className="h-14 border-b border-border flex items-center px-6 gap-3 shrink-0">
        <Input
          value={chapter.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="border-0 px-0 h-auto text-lg font-semibold focus-visible:ring-0 bg-transparent"
          placeholder="章节标题"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
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
              className="gap-1.5 shrink-0 bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90"
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

      {/* 工具栏 */}
      <div className="min-h-9 border-b border-border bg-muted/20 flex flex-wrap items-center px-3 sm:px-4 py-1 gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => tiptapRef.current?.toggleBold()}
          title="粗体 (Ctrl+B)"
        >
          <Bold className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => tiptapRef.current?.toggleItalic()}
          title="斜体 (Ctrl+I)"
        >
          <Italic className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => tiptapRef.current?.toggleHeading()}
          title="小节标题"
        >
          <Heading className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => tiptapRef.current?.toggleBlockquote()}
          title="引用"
        >
          <Quote className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => tiptapRef.current?.toggleBulletList()}
          title="列表"
        >
          <List className="w-3.5 h-3.5" />
        </Button>

        <div className="mx-1 h-4 w-px bg-border" />

        <Button
          variant={indent ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setIndent((v) => !v)}
          title="切换首行缩进两字"
        >
          <Indent className="w-3.5 h-3.5" />
          <span className="hidden md:inline">首行缩进</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setFontSize((s) => (s === 15 ? 17 : s === 17 ? 19 : 15))}
          title="切换正文字号"
        >
          {fontSize}px
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => {
            tiptapRef.current?.autoFormat()
            toast.success('已完成一键排版（清理空行与多余空格）')
          }}
          title="一键清理多余空行与段首空格"
        >
          <AlignJustify className="w-3.5 h-3.5" />
          <span className="hidden md:inline">一键排版</span>
        </Button>

        <span className="ml-2 text-[11px] text-muted-foreground hidden xl:inline">
          输入 @ 引用设定 · AI 草稿独立于撤销栈
        </span>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {aiLoading ? (
            <span className="text-teal- flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              AI 写入草稿中...
            </span>
          ) : (
            <>
              <span>{chapter.words} 字</span>
              {chapter.words > 0 && (
                <span className="text-muted-foreground/70">
                  约 {Math.ceil(chapter.words / 400)} 分钟阅读
                </span>
              )}
            </>
          )}
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
          onSaveShortcut={onManualSave}
        />

        {/* 内联 AI 悬浮菜单 */}
        {selectedText && inlineMenuOpen && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
            <Popover open={inlineMenuOpen} onOpenChange={setInlineMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5 shadow-lg border-teal-"
                  onClick={(e) => e.preventDefault()}
                >
                  {aiLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-teal-" />
                  )}
                  AI 处理选中文字
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="center">
                <div className="grid grid-cols-2 gap-1 text-sm">
                  <button
                    onClick={() => handleInlineAI('polish')}
                    className="px-3 py-2 hover:bg-muted rounded text-left"
                  >
                    润色
                  </button>
                  <button
                    onClick={() => handleInlineAI('expand')}
                    className="px-3 py-2 hover:bg-muted rounded text-left"
                  >
                    扩写
                  </button>
                  <button
                    onClick={() => handleInlineAI('shorten')}
                    className="px-3 py-2 hover:bg-muted rounded text-left"
                  >
                    缩写
                  </button>
                  <button
                    onClick={() => handleInlineAI('continue')}
                    className="px-3 py-2 hover:bg-muted rounded text-left"
                  >
                    续写
                  </button>
                  <button
                    onClick={() => handleInlineAI('style_change', '古风')}
                    className="px-3 py-2 hover:bg-muted rounded text-left col-span-2"
                  >
                    转古风文风
                  </button>
                  <button
                    onClick={() => handleInlineAI('style_change', '科幻')}
                    className="px-3 py-2 hover:bg-muted rounded text-left col-span-2"
                  >
                    转科幻文风
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  )
}
