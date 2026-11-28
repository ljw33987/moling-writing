'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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
import { CHAPTER_STATUS } from '@/lib/helpers'
import { getStoredSkillIds } from '@/lib/writing-skills'
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
  const [aiPreview, setAiPreview] = useState('')
  const [selRect, setSelRect] = useState<{ left: number; top: number; bottom: number; right: number } | null>(null)
  const [genChapterOpen, setGenChapterOpen] = useState(false)
  const [coreEvent, setCoreEvent] = useState('')
  const [genWords, setGenWords] = useState<'1500' | '2500' | '3500'>('2500')
  const [genPov, setGenPov] = useState<'第三人称限知' | '第三人称全知' | '第一人称'>('第三人称限知')
  const [genMode, setGenMode] = useState<'continue' | 'new_scene'>('continue')
  const [indent, setIndent] = useState(true)
  const [fontSize, setFontSize] = useState(17)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // 选区位置：悬浮条贴着光标显示，避免长文里还要滚到窗口底部去找按钮
  const syncSelRect = useCallback(() => {
    const rect = tiptapRef.current?.getSelectionRect() || null
    setSelRect(rect)
  }, [tiptapRef])

  // 始终持有最新的章节与回调：
  // AI 生成是异步的，期间父组件可能已经更新过章节数据，
  // 用闭包里的旧值回写会把正文回滚掉。
  const latestRef = useRef({ chapter, onTitleChange })
  latestRef.current = { chapter, onTitleChange }

  useEffect(() => {
    if (!inlineMenuOpen || aiLoading) return
    const onScroll = () => syncSelRect()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [inlineMenuOpen, aiLoading, syncSelRect])

  // 内联 AI 操作（润色 / 扩写 / 缩写 / 续写 / 转文风）：走流式接口，边生成边回显
  const handleInlineAI = async (preset: string, targetStyle?: string) => {
    const editor = tiptapRef.current
    if (!selectedText || !editor || aiLoading) return
    setAiLoading(true)
    setAiPreview('')
    // 记录选区位置：续写要保留原文、把新增内容追加到选区之后，其余操作替换选区
    const rawEditor = editor.getEditor()
    if (!rawEditor) {
      toast.error('编辑器尚未就绪，请稍后再试')
      return
    }
    const selFrom = rawEditor.state.selection.from
    const selTo = rawEditor.state.selection.to
    // 选区前后文（参考 Sudowrite/NovelAI 的通行做法）：
    // 扩写带「前文 + 片段 + 后文」三段，保证扩写结果与上下文无缝衔接；
    // 续写带「上文」承接、带「后文」参考走向，避免新增剧情与后文打架。
    const docSize = rawEditor.state.doc.content.size
    const textBefore = rawEditor.state.doc.textBetween(0, selFrom, '\n\n').slice(-800)
    const textAfter = rawEditor.state.doc.textBetween(selTo, docSize, '\n\n').slice(0, 400)
    const selLen = selectedText.replace(/\s/g, '').length
    let inlineMessage = selectedText
    if (preset === 'expand') {
      inlineMessage =
        (textBefore ? `【前文（仅用于衔接口吻与事实，不要改写、不要复述）】\n${textBefore}\n\n` : '') +
        `【待扩写片段】\n${selectedText}\n\n` +
        (textAfter ? `【后文（扩写结果要能自然接到它上面，不要与其重复剧情）】\n${textAfter}\n\n` : '') +
        `请扩写【待扩写片段】。硬性要求：扩写后篇幅为原文的 1.5—2.5 倍（原文约 ${selLen} 字，控制在 ${Math.round(selLen * 2)} 字上下）；保留原句核心信息、人物口吻与既有事实，不新增剧情事件，不写成整段场景描写；只输出扩写后的文本，不要解释。`
    } else if (preset === 'continue') {
      const carry = ((textBefore ? textBefore + '\n\n' : '') + selectedText).slice(-1000)
      inlineMessage =
        `【上文（续写要紧接它的末尾自然承接）】\n${carry}\n\n` +
        (textAfter ? `【后文（仅用于参考剧情走向，续写内容不要与其重复或矛盾）】\n${textAfter}\n\n` : '') +
        `请续写 2—4 句（约 80—200 字）：只输出新增内容，不要重复或改写上文，不要总结收尾，人称、时态与文风和上文保持一致。`
    } else if (preset === 'shorten') {
      inlineMessage = `请缩写以下文本，只保留核心信息，篇幅不超过原文一半；只输出缩写后的文本，不要解释。\n\n${selectedText}`
    }
    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          preset,
          message: inlineMessage,
          targetStyle,
          novelId: novel.id,
          chapterId: chapter?.id,
          skillIds: getStoredSkillIds(novel.id),
        }),
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `请求失败 (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reply = ''
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
            const chunk = parsed.delta || parsed.text || parsed.content || ''
            if (chunk) {
              reply += chunk
              setAiPreview(reply)
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
      if (tiptapRef.current !== editor) return
      if (!reply.trim()) {
        toast.error('AI 未返回内容')
        return
      }
      let output = reply.trim()
      // 去掉模型自加的引导语（「好的，以下是…」「以下是扩写后的文本：」之类）
      output = output
        .replace(/^好的[，,。!！]?\s*/, '')
        .replace(/^(?:以下|下面)[是为][^\n]{0,24}[：:]\s*/, '')
        .trim()
      if (preset === 'continue') {
        // 续写：保留选中的原文，把新增内容追加到选区末尾
        editor.insertContentAt(selTo, output)
      } else {
        editor.replaceSelection(output)
      }
      toast.success('已应用 AI 修改（Ctrl+Z 可整段撤销）')
    } catch (e: any) {
      toast.error(e.message || 'AI 修改失败')
    } finally {
      setAiLoading(false)
      setAiPreview('')
    }
  }

  // 一键生成整章（流式写入 AiDraft 待采纳容器，不直接覆盖正文）
  const handleGenerateChapter = async () => {
    if (!coreEvent.trim() || !chapter) {
      toast.error('请填写核心事件')
      return
    }
    // 发稿前自动巡检：确定性规则（失效引用/重名设定/缺失摘要），零 AI 成本，只提示不阻断
    try {
      const gres = await fetch('/api/guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId: novel.id, withAi: false }),
      })
      if (gres.ok) {
        const g = await gres.json()
        if (g.scannedCount > 0) {
          toast.warning(
            `一致性巡检发现 ${g.scannedCount} 项待处理问题，可在「长篇工具 → 一致性守卫」查看与一键修复`,
            { duration: 6000 }
          )
        }
      }
    } catch { }
    const editor = tiptapRef.current
    if (!editor || generation.current || aiLoading) return
    const request = new AbortController()
    generation.current = request
    setAiLoading(true)
    setGenChapterOpen(false)
    const runId = `ch-${Date.now()}`
    editor.startAiDraftStream(runId)

    // 首行单独缓冲：若 AI 按约定输出了「第X章 标题」，就拿它当章节名，并从正文里去掉
    let headerBuf = ''
    let headerDecided = false
    let generatedTitle = ''

    try {
      const modeInstruction =
        genMode === 'continue'
          ? '承接方式：顺着当前章节已有末尾自然往下续写推进'
          : '承接方式：直接切入新场景/新起一章推进剧情'
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          preset: 'chapter_gen',
          message:
            `核心事件（本章必须完成，不得忽略、不得改写为别的情节）：${coreEvent}\n` +
            `目标字数：约 ${genWords} 字\n` +
            `叙事视角：${genPov}\n` +
            `${modeInstruction}`,
          novelId: novel.id,
          chapterId: chapter.id,
          skillIds: getStoredSkillIds(novel.id),
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
          let chunk = ''
          try {
            const parsed = JSON.parse(payload)
            if (parsed.error) throw new Error(parsed.error)
            chunk = parsed.text || parsed.content || parsed.delta || ''
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
          if (!chunk) continue
          if (request.signal.aborted || tiptapRef.current !== editor) continue

          if (!headerDecided) {
            headerBuf += chunk
            const nl = headerBuf.indexOf('\n')
            if (nl === -1) {
              if (headerBuf.length > 60) {
                // 首行过长，显然不是标题，整段当作正文
                headerDecided = true
                editor.appendAiDraftChunk(headerBuf)
                headerBuf = ''
              }
              continue
            }
            const firstLine = headerBuf.slice(0, nl).replace(/^#+\s*/, '').trim()
            const rest = headerBuf.slice(nl + 1)
            headerDecided = true
            headerBuf = ''
            if (firstLine && firstLine.length <= 40 && /第.{0,4}章/.test(firstLine)) {
              generatedTitle = firstLine
            } else {
              editor.appendAiDraftChunk(firstLine + '\n' + rest)
              continue
            }
            if (rest) editor.appendAiDraftChunk(rest)
          } else {
            editor.appendAiDraftChunk(chunk)
          }
        }
      }

      if (request.signal.aborted || tiptapRef.current !== editor) return
      // 首行没被换行切断时的兜底
      if (!headerDecided && headerBuf) editor.appendAiDraftChunk(headerBuf)
      editor.finishAiDraftStream()
      if (generatedTitle && (!latestRef.current.chapter?.words || !latestRef.current.chapter?.title.trim())) {
        latestRef.current.onTitleChange(generatedTitle)
        toast.success(`AI 草稿已生成，章节名已设为「${generatedTitle}」，请在正文区点击「采纳」或「丢弃」`)
      } else {
        toast.success('AI 草稿已生成，请在正文区点击「采纳」或「丢弃」')
      }
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
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 sm:px-6 py-2 text-xs">
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
              className="border-0 px-0 h-auto text-lg sm:text-[22px] font-bold tracking-tight focus-visible:ring-0 bg-transparent shadow-none"
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">字数目标</Label>
                  <select
                    aria-label="字数目标"
                    value={genWords}
                    onChange={(e) => setGenWords(e.target.value as '1500' | '2500' | '3500')}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="1500">约 1500 字</option>
                    <option value="2500">约 2500 字</option>
                    <option value="3500">约 3500 字</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">叙事视角</Label>
                  <select
                    aria-label="叙事视角"
                    value={genPov}
                    onChange={(e) => setGenPov(e.target.value as '第三人称限知' | '第三人称全知' | '第一人称')}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="第三人称限知">第三人称限知</option>
                    <option value="第三人称全知">第三人称全知</option>
                    <option value="第一人称">第一人称</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">承接方式</Label>
                  <select
                    aria-label="承接方式"
                    value={genMode}
                    onChange={(e) => setGenMode(e.target.value as 'continue' | 'new_scene')}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="continue">续写本章</option>
                    <option value="new_scene">新起场景</option>
                  </select>
                </div>
              </div>
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
            if (text) {
              // 等一帧，确保 ProseMirror 已更新选区坐标
              requestAnimationFrame(() => syncSelRect())
            } else {
              setSelRect(null)
            }
          }}
          onHistoryChange={(u, r) => {
            setCanUndo(u)
            setCanRedo(r)
          }}
          onSaveShortcut={onManualSave}
        />

        {/* 内联 AI 悬浮条：贴着选区显示，长文写作时不用滚到窗口底部找按钮 */}
        {selectedText && inlineMenuOpen && (
          <div
            className="fixed z-30 flex flex-col gap-1 rounded-[10px] bg-[#1B1B24] dark:bg-[#262A36] text-white border border-white/10 shadow-xl max-w-[min(92vw,420px)]"
            style={
              selRect
                ? {
                    left: Math.max(8, Math.min(selRect.left, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 220)),
                    top: Math.max(8, selRect.bottom + 8),
                  }
                : { left: '50%', top: '50%' }
            }
          >
            <div className="flex items-center gap-0.5 px-1.5 py-1 whitespace-nowrap">
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => handleInlineAI('polish')}
                className="h-7 px-2.5 rounded-[7px] text-xs font-medium hover:bg-white/10 inline-flex items-center gap-1 text-[#C3C6FF] whitespace-nowrap"
              >
                {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                润色
              </button>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => handleInlineAI('expand')}
                className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10 whitespace-nowrap"
              >
                扩写
              </button>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => handleInlineAI('shorten')}
                className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10 whitespace-nowrap"
              >
                缩写
              </button>
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => handleInlineAI('continue')}
                className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10 whitespace-nowrap"
              >
                续写
              </button>
              <span className="w-px h-4 bg-white/15 mx-0.5" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={aiLoading}
                    className="h-7 px-2.5 rounded-[7px] text-xs hover:bg-white/10 whitespace-nowrap"
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

            {/* 流式生成实时回显：让作者看到 AI 正在写什么，而不是干等 */}
            {aiLoading && (
              <div className="px-2.5 pb-2 pt-0.5 text-[11px] leading-relaxed text-white/70 max-h-24 overflow-hidden">
                <span className="text-white/90">生成中…</span>{' '}
                {aiPreview.slice(-160)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
