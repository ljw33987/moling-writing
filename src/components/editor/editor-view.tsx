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
import { EditorToolbar } from './editor-toolbar'
import { MindmapMainPanel, type MindmapFile } from './mindmap-main-panel'
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
  const [mindmapFiles, setMindmapFiles] = useState<MindmapFile[]>([])
  const [activeMindmapId, setActiveMindmapId] = useState<string | null>(null)

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

  // 插入正文：用干净的纯文本段落替换左侧当前章节的全部正文（不带颜色或草稿框）
  const handleInsertText = (text: string) => {
    if (!currentChapter) {
      toast.error('请先选择一个章节')
      return
    }
    if (tiptapRef.current) {
      tiptapRef.current.replaceAllContent(text)
      toast.success('已替换当前章节正文')
      return
    }
    handleContentChange(text)
    toast.success('已替换当前章节正文')
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
    <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
      {/* 顶部工作区工具栏 */}
      <div className="h-10 shrink-0 border-b border-border bg-card/50 flex items-center px-3 gap-1.5 text-xs overflow-x-auto">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={toggleLeftPanel} title="切换左侧栏">
          <PanelLeft className="w-4 h-4" />
        </Button>
        <span className="font-semibold truncate max-w-[160px]">{novel.title}</span>
        <span className="text-muted-foreground shrink-0">/</span>
        <span className="text-muted-foreground truncate max-w-[160px]">{currentChapter?.title || '未选择章节'}</span>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <AutoSerialPanel
            novelId={novel.id}
            onChapterCreated={(newId) => {
              void loadNovel()
              if (newId) setCurrentChapter(newId)
            }}
          />
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
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 overflow-hidden">
        {leftPanelOpen && (
          <>
            <ResizablePanel defaultSize={23} minSize={18} maxSize={35} className="h-full min-h-0 overflow-hidden">
              <LeftSidebarPanel
                novel={novel}
                currentChapterId={currentChapterId}
                currentChapterContent={currentChapter?.content || ''}
                mindmapFiles={mindmapFiles}
                activeMindmapId={activeMindmapId}
                onSelectChapter={(id) => {
                  setActiveMindmapId(null)
                  setCurrentChapter(id)
                }}
                onSelectMindmap={(id) => setActiveMindmapId(id)}
                onCreateMindmap={handleCreateMindmap}
                onDeleteMindmap={handleDeleteMindmap}
                onTreeChange={handleTreeChange}
                onInsertCodexRef={(id) =>
                  tiptapRef.current?.getEditor()?.chain().focus().insertCodexRef(id).run()
                }
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel defaultSize={50} minSize={35} className="h-full min-h-0 overflow-hidden">
          {activeMindmap ? (
            <MindmapMainPanel
              file={activeMindmap}
              novelId={novel.id}
              onChange={handleUpdateMindmap}
              onBackToEditor={() => setActiveMindmapId(null)}
            />
          ) : (
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
          )}
        </ResizablePanel>

        {rightPanelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={27} minSize={20} maxSize={42} className="h-full min-h-0 overflow-hidden">
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
