'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { api, countWords, formatWords } from '@/lib/helpers'
import { LeftSidebarPanel } from './left-sidebar-panel'
import { EditorPanel } from './editor-panel'
import type { NovelTiptapHandle } from './novel-tiptap-editor'
import { useAutosave } from '@/hooks/use-autosave'
import { AiAssistant } from '@/components/ai/ai-assistant'
import { AutoSerialPanel } from './auto-serial-panel'
import { LongNovelTools } from './long-novel-tools'
import { EditorToolbar, HistoryTool, WordGoalTool } from './editor-toolbar'
import { MindmapMainPanel, type MindmapFile } from './mindmap-main-panel'
import { Button } from '@/components/ui/button'
import { PanelLeft, PanelRight, Eye, Moon, Sun, Type, Sparkles, ArrowLeft } from 'lucide-react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { toast } from 'sonner'

export interface Volume {
  id: string
  title: string
  sortOrder: number
  isOutline: boolean
  chapters: Chapter[]
}

export interface Chapter {
  id: string
  title: string
  content: string
  summary: string | null
  words: number
  status: string
  sortOrder: number
  volumeId: string
}

export interface NovelDetail {
  id: string
  title: string
  synopsis: string | null
  outline: string | null
  genre: string
  wordGoal?: number
  writingStyleId?: string | null
  volumes: Volume[]
}

export function EditorView() {
  const {
    currentNovelId,
    currentChapterId,
    setCurrentChapter,
    leftPanelOpen,
    rightPanelOpen,
    toggleLeftPanel,
    toggleRightPanel,
    editorMode,
    setEditorMode,
    theme,
    setTheme,
    backToWorkspace,
  } = useAppStore()

  const [novel, setNovel] = useState<NovelDetail | null>(null)
  const [chapterState, setCurrentChapterState] = useState<Chapter | null>(null)
  const currentChapter = chapterState?.id === currentChapterId ? chapterState : null
  const novelLoadId = useRef(0)
  const [loading, setLoading] = useState(true)
  const [mindmapFiles, setMindmapFiles] = useState<MindmapFile[]>([])
  const [activeMindmapId, setActiveMindmapId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileDrawer, setMobileDrawer] = useState<'chapters' | 'assistant' | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => {
      setIsMobile(media.matches)
      if (!media.matches) setMobileDrawer(null)
    }
    const frame = window.requestAnimationFrame(update)
    media.addEventListener('change', update)
    return () => {
      window.cancelAnimationFrame(frame)
      media.removeEventListener('change', update)
    }
  }, [])

  useEffect(() => {
    if (!currentNovelId) return
    try {
      const raw = localStorage.getItem(`moling_mindmap_files_${currentNovelId}`)
      setMindmapFiles(raw ? JSON.parse(raw) : [])
    } catch {
      setMindmapFiles([])
    }
    setActiveMindmapId(null)
  }, [currentNovelId])

  const saveMindmapFiles = useCallback(
    (next: MindmapFile[]) => {
      setMindmapFiles(next)
      if (!currentNovelId) return
      try {
        localStorage.setItem(`moling_mindmap_files_${currentNovelId}`, JSON.stringify(next))
      } catch {}
    },
    [currentNovelId]
  )

  const handleCreateMindmap = (file: MindmapFile) => {
    saveMindmapFiles([file, ...mindmapFiles])
    setActiveMindmapId(file.id)
  }

  const handleUpdateMindmap = (updated: MindmapFile) => {
    saveMindmapFiles(mindmapFiles.map((f) => (f.id === updated.id ? updated : f)))
  }

  const handleDeleteMindmap = (id: string) => {
    saveMindmapFiles(mindmapFiles.filter((f) => f.id !== id))
    if (activeMindmapId === id) setActiveMindmapId(null)
  }

  const activeMindmap = activeMindmapId
    ? mindmapFiles.find((f) => f.id === activeMindmapId) || null
    : null
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tiptapRef = useRef<NovelTiptapHandle | null>(null)

  const saveChapterToServer = useCallback(async (id: string, content: string) => {
    await api('/api/chapters', {
      method: 'PATCH',
      body: JSON.stringify({ id, content }),
    })
    setNovel((prev) => {
      if (!prev) return prev
      const words = countWords(content)
      return {
        ...prev,
        volumes: prev.volumes.map((v) => ({
          ...v,
          chapters: v.chapters.map((c) => (c.id === id ? { ...c, content, words } : c)),
        })),
      }
    })
  }, [])

  const {
    state: saveState,
    recoveryDraft,
    checkRecovery,
    queueSave,
    flush,
    acceptRecovery,
    dismissRecovery,
  } = useAutosave(currentChapterId, saveChapterToServer, 1800)

  const loadNovel = useCallback(async () => {
    if (!currentNovelId) return
    const loadId = ++novelLoadId.current
    const isCurrent = () => loadId === novelLoadId.current &&
      useAppStore.getState().currentNovelId === currentNovelId
    try {
      const r = await api<{ novel: NovelDetail }>(`/api/novels?id=${currentNovelId}`)
      if (!isCurrent()) return
      setNovel(r.novel)
      const allChapters = r.novel.volumes.flatMap((v) => v.chapters)
      const selectedId = useAppStore.getState().currentChapterId
      setCurrentChapter(allChapters.find((c) => c.id === selectedId)?.id ?? allChapters[0]?.id ?? null)
    } catch (e: any) {
      if (isCurrent()) toast.error(e.message || '加载小说失败')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [currentNovelId, setCurrentChapter])

  useEffect(() => {
    loadNovel()
  }, [loadNovel])

  // 当 currentChapterId 变化时，从 novel 中找到当前章节
  useEffect(() => {
    if (!novel) {
      setCurrentChapterState(null)
      return
    }
    if (currentChapterId) {
      for (const v of novel.volumes) {
        const c = v.chapters.find((c) => c.id === currentChapterId)
        if (c) {
          setCurrentChapterState(c)
          void checkRecovery(c.id, c.content)
          return
        }
      }
    }
    setCurrentChapterState(null)
  }, [novel, currentChapterId, checkRecovery])

  // 三层防丢稿自动保存（IndexedDB + 节流上传）
  const handleContentChange = (content: string) => {
    if (!currentChapter) return
    const updated = { ...currentChapter, content, words: countWords(content) }
    setCurrentChapterState(updated)
    queueSave(currentChapter.id, content)
  }

  const handleManualSave = () => {
    if (!currentChapter) return
    void flush(currentChapter.id).then((result) => {
      if (result === 'saved' || result === 'idle') toast.success('同步完成')
      else if (result === 'offline') toast.error('离线，草稿保存在本机')
      else if (result === 'error') toast.error('同步失败，草稿保存在本机')
    })
  }

  const handleAcceptRecovery = () => {
    const draft = acceptRecovery()
    if (!draft || !currentChapter) return
    setCurrentChapterState({
      ...currentChapter,
      content: draft.content,
      words: countWords(draft.content),
    })
    toast.success('已恢复本地离线草稿')
  }

  // 章节标题更新
  // 注意：必须始终基于最新的 chapterState 改写。
  // 早期版本直接用闭包里的 currentChapter，AI 生成过程中（异步）回调时会拿到
  // 生成前的旧内容，把正文回滚并触发编辑器重置，导致刚生成的 AI 草稿被清空。
  const chapterStateRef = useRef<Chapter | null>(null)
  chapterStateRef.current = chapterState

  const handleTitleChange = async (title: string) => {
    const latest = chapterStateRef.current
    if (!latest) return
    const updated = { ...latest, title }
    setCurrentChapterState(updated)
    setNovel((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        volumes: prev.volumes.map((v) => ({
          ...v,
          chapters: v.chapters.map((c) => (c.id === latest.id ? updated : c)),
        })),
      }
    })

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await api('/api/chapters', {
          method: 'PATCH',
          body: JSON.stringify({ id: latest.id, title }),
        })
      } catch (e: any) {
        toast.error('保存失败：' + e.message)
      }
    }, 1000)
  }

  // 更新章节状态
  const handleStatusChange = async (status: string) => {
    if (!currentChapter) return
    try {
      await api('/api/chapters', {
        method: 'PATCH',
        body: JSON.stringify({ id: currentChapter.id, status }),
      })
      const updated = { ...currentChapter, status }
      setCurrentChapterState(updated)
      setNovel((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          volumes: prev.volumes.map((v) => ({
            ...v,
            chapters: v.chapters.map((c) => (c.id === currentChapter.id ? updated : c)),
          })),
        }
      })
      toast.success('状态已更新')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // 章节被树中操作后的刷新
  const handleTreeChange = (chapterId?: string) => {
    if (chapterId) {
      setActiveMindmapId(null)
      setMobileDrawer(null)
      setCurrentChapter(chapterId)
    }
    void loadNovel()
  }

  // 安全追加到正文末尾（不覆盖原稿）
  const handleInsertText = (text: string) => {
    if (!currentChapter) {
      toast.error('请先选择一个章节')
      return
    }
    if (tiptapRef.current) {
      tiptapRef.current.appendContent(text)
      toast.success('已追加到正文末尾')
      return
    }
    const merged = currentChapter.content?.trim()
      ? `${currentChapter.content.trim()}\n${text}`
      : text
    handleContentChange(merged)
    toast.success('已追加到正文末尾')
  }

  // 替换整章正文（仅在用户明确确认替换时调用）
  const handleReplaceChapterText = (text: string) => {
    if (!currentChapter) {
      toast.error('请先选择一个章节')
      return
    }
    if (tiptapRef.current) {
      tiptapRef.current.replaceAllContent(text)
      toast.success('已替换整章正文')
      return
    }
    handleContentChange(text)
    toast.success('已替换整章正文')
  }

  // 替换选中文字
  const handleReplaceSelection = (text: string) => {
    if (!currentChapter) return
    // 简单实现：追加到末尾（精确替换由编辑器内部处理）
    handleInsertText(text)
  }

  if (loading || !novel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    )
  }

  const totalWords = novel.volumes.reduce(
    (s, v) => s + v.chapters.reduce((s2, c) => s2 + c.words, 0),
    0
  )

  return (
    <div className="studio-editor flex-1 h-full min-h-0 flex flex-col overflow-hidden">
      {/* 顶部工作区工具栏 */}
      <div className="studio-editor-bar shrink-0 border-b border-border flex items-center px-3 gap-1.5 text-xs overflow-x-auto">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1 text-xs shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => backToWorkspace()}
          title="返回书架"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">返回书架</span>
        </Button>
        <div className="h-4 w-px bg-border shrink-0" />
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => isMobile ? setMobileDrawer('chapters') : toggleLeftPanel()} title={isMobile ? '打开目录与设定' : '切换左侧栏'} aria-label={isMobile ? '打开目录与设定' : '切换左侧栏'}>
          <PanelLeft className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" onClick={() => setMobileDrawer('assistant')} title="打开 AI 助手" aria-label="打开 AI 助手">
          <PanelRight className="w-4 h-4" />
        </Button>
        <span className="font-display font-semibold truncate max-w-[100px] sm:max-w-[160px] text-ink">{novel.title}</span>
        <span className="hidden xl:inline text-muted-foreground shrink-0">/</span>
        <span className="hidden xl:inline text-muted-foreground truncate max-w-[160px]">{currentChapter?.title || '未选择章节'}</span>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <AutoSerialPanel
            novelId={novel.id}
            volumes={novel.volumes}
            onChapterCreated={handleTreeChange}
          />
          <LongNovelTools
            novelId={novel.id}
            chapterId={currentChapterId}
            chapterContent={currentChapter?.content || ''}
            volumes={novel.volumes}
            onJumpChapter={setCurrentChapter}
            onInsertAiDraft={handleReplaceChapterText}
            onChapterUpdated={() => void loadNovel()}
          />
          <EditorToolbar
            novelId={novel.id}
            novelTitle={novel.title}
            chapterId={currentChapterId}
            onJumpChapter={setCurrentChapter}
          />

          {saveState === 'saving' ? (
            <span className="text-gold flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-gold rounded-full animate-pulse" />
              保存中...
            </span>
          ) : saveState === 'dirty' ? (
            <span className="text-gold">本地已暂存</span>
          ) : saveState === 'offline' ? (
            <span className="text-gold">离线（已存本地）</span>
          ) : saveState === 'error' ? (
            <span className="text-cinnabar">同步失败（已存本地）</span>
          ) : saveState === 'saved' ? (
            <span className="text-jade">已自动保存</span>
          ) : null}

          <span className="text-muted-foreground">
            {formatWords(currentChapter?.words || 0)} 字 / 共 {formatWords(totalWords)} 字
          </span>

          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${editorMode === 'typewriter' ? 'bg-secondary' : ''}`}
            onClick={() => setEditorMode(editorMode === 'typewriter' ? 'normal' : 'typewriter')}
            title="打字机模式"
          >
            <Type className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${editorMode === 'focus' ? 'bg-secondary' : ''}`}
            onClick={() => setEditorMode(editorMode === 'focus' ? 'normal' : 'focus')}
            title="专注模式（高亮当前段落）"
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${theme === 'dark' ? 'bg-secondary' : ''}`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="深色模式"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setTheme(theme === 'eye' ? 'light' : 'eye')}
            title="护眼模式"
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex h-8 w-8" onClick={() => toggleRightPanel()} title="切换 AI 助手" aria-label="切换 AI 助手">
            <PanelRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 三栏布局 */}
      {isMobile ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeMindmap ? (
            <MindmapMainPanel
              file={activeMindmap}
              novelId={novel.id}
              onChange={handleUpdateMindmap}
              onBackToEditor={() => setActiveMindmapId(null)}
            />
          ) : (
            <EditorPanel
              key={currentChapterId ?? 'unselected'}
              chapter={currentChapter}
              novel={novel}
              onContentChange={handleContentChange}
              onTitleChange={handleTitleChange}
              onStatusChange={handleStatusChange}
              editorMode={editorMode}
              onInsertText={handleInsertText}
              onManualSave={handleManualSave}
              recoveryDraft={recoveryDraft}
              onAcceptRecovery={handleAcceptRecovery}
              onDismissRecovery={dismissRecovery}
              tiptapRef={tiptapRef}
            />
          )}
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" autoSaveId={`editor-layout-${novel.id}`} className="flex-1 min-h-0 overflow-hidden">
          {leftPanelOpen && (
            <>
              <ResizablePanel defaultSize={24} minSize={18} maxSize={35} className="h-full min-h-0 overflow-hidden">
                <LeftSidebarPanel
                  novel={novel}
                  currentChapterId={currentChapterId}
                  currentChapterContent={currentChapter?.content || ''}
                  mindmapFiles={mindmapFiles}
                  activeMindmapId={activeMindmapId}
                  onSelectChapter={(id) => {
                    setActiveMindmapId(null)
                    setCurrentChapter(id)
                    setMobileDrawer(null)
                  }}
                  onSelectMindmap={(id) => {
                    setActiveMindmapId(id)
                    setMobileDrawer(null)
                  }}
                  onCreateMindmap={handleCreateMindmap}
                  onDeleteMindmap={handleDeleteMindmap}
                  onTreeChange={handleTreeChange}
                  onWritingStyleChange={(styleId) =>
                    setNovel((prev) => (prev ? { ...prev, writingStyleId: styleId } : prev))
                  }
                  onInsertCodexRef={(id) =>
                    tiptapRef.current?.getEditor()?.chain().focus().insertCodexRef(id).run()
                  }
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          <ResizablePanel defaultSize={48} minSize={35} className="h-full min-h-0 overflow-hidden">
            {activeMindmap ? (
              <MindmapMainPanel
                file={activeMindmap}
                novelId={novel.id}
                onChange={handleUpdateMindmap}
                onBackToEditor={() => setActiveMindmapId(null)}
              />
            ) : (
              <EditorPanel
                key={currentChapterId ?? 'unselected'}
                chapter={currentChapter}
                novel={novel}
                onContentChange={handleContentChange}
                onTitleChange={handleTitleChange}
                onStatusChange={handleStatusChange}
                editorMode={editorMode}
                onInsertText={handleInsertText}
                onManualSave={handleManualSave}
                recoveryDraft={recoveryDraft}
                onAcceptRecovery={handleAcceptRecovery}
                onDismissRecovery={dismissRecovery}
                tiptapRef={tiptapRef}
              />
            )}
          </ResizablePanel>

          {rightPanelOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={28} minSize={20} maxSize={42} className="studio-ai-column h-full min-h-0 overflow-hidden">
                <AiAssistant
                  novelId={currentNovelId!}
                  chapterId={currentChapterId}
                  writingStyleId={novel.writingStyleId ?? null}
                  chapters={novel.volumes.flatMap((v) => v.chapters.map((c) => ({ id: c.id, title: c.title, words: c.words })))}
                  onWritingStyleChange={(styleId) =>
                    setNovel((prev) => (prev ? { ...prev, writingStyleId: styleId } : prev))
                  }
                  onChaptersUpdated={() => void loadNovel()}
                  onInsertText={handleInsertText}
                  onReplaceChapterText={handleReplaceChapterText}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}

      <footer className="studio-editor-footer text-xs text-muted-foreground">
        <div className="flex items-center gap-2.5 tnum">
          <span>本章 <b className="text-foreground font-semibold">{formatWords(currentChapter?.words || 0)}</b> 字</span>
          <span>·</span>
          <span>全书 <b className="text-foreground font-semibold">{formatWords(totalWords)}</b> 字</span>
          {(currentChapter?.words || 0) > 0 && (
            <>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">约 {Math.ceil((currentChapter?.words || 0) / 400)} 分钟阅读</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${saveState === 'saved' ? 'bg-[var(--jade)]' : saveState === 'error' ? 'bg-[var(--cinnabar)]' : 'bg-[var(--gold)] animate-pulse'}`} />
            {saveState === 'saving' ? '保存中...' : saveState === 'dirty' ? '本地已暂存' : saveState === 'offline' ? '离线（已存本地）' : saveState === 'error' ? '同步失败' : '已自动保存'}
          </span>
          <WordGoalTool novelId={novel.id} wordGoal={novel.wordGoal ?? 0} totalWords={totalWords} />
          <HistoryTool chapterId={currentChapterId} onReload={loadNovel} />
        </div>
      </footer>

      <nav className="studio-editor-actions lg:hidden" aria-label="写作工具">
        <Button variant="ghost" onClick={() => setMobileDrawer('chapters')}><PanelLeft />目录</Button>
        <Button variant="ghost" aria-pressed={editorMode === 'focus'} onClick={() => setEditorMode(editorMode === 'focus' ? 'normal' : 'focus')}><Eye />专注</Button>
        <Button variant="ghost" onClick={() => setMobileDrawer('assistant')}><PanelRight />AI 助手</Button>
      </nav>

      <Sheet open={isMobile && mobileDrawer === 'chapters'} onOpenChange={(open) => setMobileDrawer(open ? 'chapters' : null)}>
        <SheetContent side="left" className="w-[min(88vw,22rem)] p-0 gap-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>目录与设定</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <LeftSidebarPanel
              novel={novel}
              currentChapterId={currentChapterId}
              currentChapterContent={currentChapter?.content || ''}
              mindmapFiles={mindmapFiles}
              activeMindmapId={activeMindmapId}
              onSelectChapter={(id) => {
                setActiveMindmapId(null)
                setCurrentChapter(id)
                setMobileDrawer(null)
              }}
              onSelectMindmap={(id) => {
                setActiveMindmapId(id)
                setMobileDrawer(null)
              }}
              onCreateMindmap={handleCreateMindmap}
              onDeleteMindmap={handleDeleteMindmap}
              onTreeChange={handleTreeChange}
              onWritingStyleChange={(styleId) =>
                setNovel((prev) => (prev ? { ...prev, writingStyleId: styleId } : prev))
              }
              onInsertCodexRef={(id) => {
                setMobileDrawer(null)
                tiptapRef.current?.getEditor()?.chain().focus().insertCodexRef(id).run()
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isMobile && mobileDrawer === 'assistant'} onOpenChange={(open) => setMobileDrawer(open ? 'assistant' : null)}>
        <SheetContent side="bottom" className="studio-assistant-sheet p-0 gap-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>AI 写作助手</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AiAssistant
              novelId={currentNovelId!}
              chapterId={currentChapterId}
              writingStyleId={novel.writingStyleId ?? null}
              chapters={novel.volumes.flatMap((v) => v.chapters.map((c) => ({ id: c.id, title: c.title, words: c.words })))}
              onWritingStyleChange={(styleId) =>
                setNovel((prev) => (prev ? { ...prev, writingStyleId: styleId } : prev))
              }
              onChaptersUpdated={() => void loadNovel()}
              onInsertText={(text) => {
                setMobileDrawer(null)
                handleInsertText(text)
              }}
              onReplaceChapterText={(text) => {
                setMobileDrawer(null)
                handleReplaceChapterText(text)
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
