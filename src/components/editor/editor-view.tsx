'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { api, countWords, formatWords } from '@/lib/helpers'
import { ChapterTree } from './chapter-tree'
import { EditorPanel } from './editor-panel'
import type { NovelTiptapHandle } from './novel-tiptap-editor'
import { useAutosave } from '@/hooks/use-autosave'
import { AiAssistant } from '@/components/ai/ai-assistant'
import { AutoSerialPanel } from './auto-serial-panel'
import { LongNovelTools } from './long-novel-tools'
import { EditorToolbar } from './editor-toolbar'
import { Button } from '@/components/ui/button'
import { PanelLeft, PanelRight, Eye, Moon, Sun, Type, Sparkles } from 'lucide-react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
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
  } = useAppStore()

  const [novel, setNovel] = useState<NovelDetail | null>(null)
  const [currentChapter, setCurrentChapterState] = useState<Chapter | null>(null)
  const [loading, setLoading] = useState(true)
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
    try {
      const r = await api<{ novel: NovelDetail }>(`/api/novels?id=${currentNovelId}`)
      setNovel(r.novel)
      // 默认选第一章
      if (!currentChapterId && r.novel.volumes.length > 0 && r.novel.volumes[0].chapters.length > 0) {
        setCurrentChapter(r.novel.volumes[0].chapters[0].id)
      }
    } catch (e: any) {
      toast.error(e.message || '加载小说失败')
    } finally {
      setLoading(false)
    }
  }, [currentNovelId, currentChapterId, setCurrentChapter])

  useEffect(() => {
    loadNovel()
  }, [loadNovel])

  // 当 currentChapterId 变化时，从 novel 中找到当前章节
  useEffect(() => {
    if (!novel || !currentChapterId) {
      setCurrentChapterState(null)
      return
    }
    for (const v of novel.volumes) {
      const c = v.chapters.find((c) => c.id === currentChapterId)
      if (c) {
        setCurrentChapterState(c)
        void checkRecovery(c.id, c.content)
        return
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
    void flush(currentChapter.id).then(() => toast.success('已保存到服务端'))
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
  const handleTitleChange = async (title: string) => {
    if (!currentChapter) return
    const updated = { ...currentChapter, title }
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

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await api('/api/chapters', {
          method: 'PATCH',
          body: JSON.stringify({ id: currentChapter.id, title }),
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
  const handleTreeChange = () => {
    loadNovel()
  }

  // 插入 AI 回复到待采纳草稿块
  const handleInsertText = (text: string) => {
    if (!currentChapter) {
      toast.error('请先选择一个章节')
      return
    }
    if (tiptapRef.current) {
      tiptapRef.current.insertAiDraftBlock(text)
      toast.success('已放入待采纳草稿区，请在正文区点击「采纳」')
      return
    }
    const newContent = currentChapter.content + (currentChapter.content ? '\n\n' : '') + text
    handleContentChange(newContent)
    toast.success('已插入到正文末尾')
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="h-10 border-b border-border bg-card/40 flex items-center px-3 gap-2 text-xs">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleLeftPanel}>
          <PanelLeft className="w-4 h-4" />
        </Button>
        <span className="font-medium truncate max-w-[200px]">{novel.title}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{currentChapter?.title || '未选择章节'}</span>

        <div className="ml-auto flex items-center gap-2">
          <AutoSerialPanel novelId={novel.id} />
          <LongNovelTools
            novelId={novel.id}
            chapterId={currentChapterId}
            chapterContent={currentChapter?.content || ''}
            onJumpChapter={setCurrentChapter}
            onInsertAiDraft={handleInsertText}
          />
          <EditorToolbar
            novelId={novel.id}
            novelTitle={novel.title}
            chapterId={currentChapterId}
            onJumpChapter={setCurrentChapter}
            onContentReload={loadNovel}
            wordGoal={(novel as any).wordGoal}
            totalWords={totalWords}
          />

          {saveState === 'saving' ? (
            <span className="text-amber-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              保存中...
            </span>
          ) : saveState === 'dirty' ? (
            <span className="text-amber-500">本地已暂存</span>
          ) : saveState === 'offline' ? (
            <span className="text-orange-500">离线（已存本地）</span>
          ) : saveState === 'error' ? (
            <span className="text-destructive">同步失败（已存本地）</span>
          ) : saveState === 'saved' ? (
            <span className="text-emerald-500">已自动保存</span>
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleRightPanel}>
            <PanelRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 三栏布局 */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {leftPanelOpen && (
          <>
            <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
              <ChapterTree
                novel={novel}
                currentChapterId={currentChapterId}
                onSelect={setCurrentChapter}
                onChange={handleTreeChange}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel defaultSize={55} minSize={40}>
          <EditorPanel
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
        </ResizablePanel>

        {rightPanelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25} minSize={18} maxSize={45}>
              <AiAssistant
                novelId={currentNovelId!}
                chapterId={currentChapterId}
                onInsertText={handleInsertText}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
