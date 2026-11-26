'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { AiDraft } from './extensions/AiDraft'
import { CodexRef } from './extensions/CodexRef'
import { Provenance } from './extensions/Provenance'
import {
  ensureParagraphIds,
  ParagraphIdentity,
} from './extensions/ParagraphIdentity'
import {
  createCodexSuggestion,
  type CodexSuggestState,
} from './extensions/codex-suggestion'
import { CodexMapContext, type CodexItem } from './extensions/codex-context'
import { api } from '@/lib/helpers'
import { Users, Map as MapIcon, Sword } from 'lucide-react'

export interface NovelTiptapHandle {
  getEditor: () => Editor | null
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  toggleBold: () => void
  toggleItalic: () => void
  toggleHeading: () => void
  toggleBlockquote: () => void
  toggleBulletList: () => void
  autoFormat: () => void
  replaceSelection: (text: string) => void
  replaceAllContent: (text: string) => void
  startAiDraftStream: (runId?: string) => void
  appendAiDraftChunk: (text: string) => void
  finishAiDraftStream: () => void
  insertAiDraftBlock: (text: string, runId?: string) => void
}

interface Props {
  novelId: string
  chapterId: string
  content: string
  editorMode: 'normal' | 'focus' | 'typewriter'
  indent?: boolean
  fontSize?: number
  onUpdate: (html: string, words: number) => void
  onSelectionChange: (selectedText: string) => void
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void
  onSaveShortcut?: () => void
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 将纯文本整理为干净的小说排版 HTML（去空行、去段首尾空格，配合编辑器首行缩进与段距）
 */
export function formatPlainToNovelHtml(raw: string): string {
  const lines = (raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
    .filter(Boolean)
  if (lines.length === 0) return '<p></p>'
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

/**
 * 兼容旧版纯文本/Markdown 章节与新版 Tiptap HTML 章节
 */
export function normalizeToEditorHtml(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return '<p></p>'
  if (trimmed.startsWith('<')) return raw
  return formatPlainToNovelHtml(raw)
}

/**
 * 提取正式正文（排除未采纳的 aiDraft 节点，移植自墨枢 Moshu）
 */
export function canonicalBody(editor: Editor): {
  html: string
  words: number
} {
  const nodes: ProseMirrorNode[] = []
  editor.state.doc.content.forEach((node) => {
    if (node.type.name !== 'aiDraft') nodes.push(node)
  })
  const fragment = Fragment.fromArray(nodes)
  const text = nodes.map((n) => n.textContent).join('')
  return {
    html: getHTMLFromFragment(fragment, editor.schema),
    words: text.replace(/\s/g, '').length,
  }
}

export const NovelTiptapEditor = forwardRef<NovelTiptapHandle, Props>(
  function NovelTiptapEditor(
    {
      novelId,
      chapterId,
      content,
      editorMode,
      indent = true,
      fontSize = 17,
      onUpdate,
      onSelectionChange,
      onHistoryChange,
      onSaveShortcut,
    },
    ref
  ) {
    const [codexItems, setCodexItems] = useState<CodexItem[]>([])
    const [suggest, setSuggest] = useState<CodexSuggestState>({
      open: false,
      items: [],
      index: 0,
      rect: { left: 0, top: 0 },
      select: () => {},
    })

    const codexMap = useMemo(() => {
      const m = new Map<string, CodexItem>()
      for (const item of codexItems) m.set(item.id, item)
      return m
    }, [codexItems])

    const searchRef = useRef<(q: string) => CodexItem[]>(() => [])
    const onUpdateRef = useRef(onUpdate)
    const onSelectionRef = useRef(onSelectionChange)
    const onSaveRef = useRef(onSaveShortcut)

    useEffect(() => {
      searchRef.current = (q: string) => {
        const query = q.trim().toLowerCase()
        const list = query
          ? codexItems.filter((i) => i.name.toLowerCase().includes(query))
          : codexItems
        return list.slice(0, 10)
      }
      onUpdateRef.current = onUpdate
      onSelectionRef.current = onSelectionChange
      onSaveRef.current = onSaveShortcut
    }, [codexItems, onUpdate, onSelectionChange, onSaveShortcut])

    // 加载本书设定库（角色 / 世界观 / 道具）
    useEffect(() => {
      let cancelled = false
      async function loadCodex() {
        try {
          const [charR, worldR, itemR] = await Promise.all([
            api<{ items: any[] }>(
              `/api/characters?type=character&novelId=${novelId}`
            ).catch(() => ({ items: [] })),
            api<{ items: any[] }>(
              `/api/characters?type=worldview&novelId=${novelId}`
            ).catch(() => ({ items: [] })),
            api<{ items: any[] }>(
              `/api/characters?type=item&novelId=${novelId}`
            ).catch(() => ({ items: [] })),
          ])
          if (cancelled) return
          const merged: CodexItem[] = [
            ...charR.items.map((c) => ({
              id: c.id,
              name: c.name,
              type: 'character' as const,
              summary: c.personality || c.background || '',
            })),
            ...worldR.items.map((w) => ({
              id: w.id,
              name: w.name || w.title,
              type: 'worldview' as const,
              summary: w.description || '',
            })),
            ...itemR.items.map((i) => ({
              id: i.id,
              name: i.name,
              type: 'item' as const,
              summary: i.effect || '',
            })),
          ]
          setCodexItems(merged)
        } catch {}
      }
      if (novelId) void loadCodex()
      return () => {
        cancelled = true
      }
    }, [novelId])

    const codexSuggestExt = useMemo(
      () => createCodexSuggestion((q) => searchRef.current(q), setSuggest),
      []
    )

    const editor = useEditor({
      immediatelyRender: false,
      content: normalizeToEditorHtml(content),
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Placeholder.configure({
          placeholder:
            '开始你的创作... 选中文字可触发 AI 润色/扩写；输入 @ 引用设定库条目',
        }),
        CharacterCount,
        ParagraphIdentity,
        AiDraft,
        Provenance,
        CodexRef,
        codexSuggestExt,
      ],
      editorProps: {
        attributes: {
          class:
            'tiptap-novel-body outline-none min-h-full px-4 py-6 sm:px-12 sm:py-10 max-w-none',
          spellcheck: 'false',
        },
        handleKeyDown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            onSaveRef.current?.()
            return true
          }
          return false
        },
      },
      onCreate: ({ editor: ed }) => {
        ensureParagraphIds(ed)
        onHistoryChange?.(ed.can().undo(), ed.can().redo())
      },
      onTransaction: ({ editor: ed }) => {
        onHistoryChange?.(ed.can().undo(), ed.can().redo())
      },
      onUpdate: ({ editor: ed }) => {
        const canonical = canonicalBody(ed)
        onUpdateRef.current(canonical.html, canonical.words)
      },
      onSelectionUpdate: ({ editor: ed }) => {
        const { from, to } = ed.state.selection
        if (to > from) {
          const selected = ed.state.doc.textBetween(from, to, '\n')
          onSelectionRef.current(selected)
        } else {
          onSelectionRef.current('')
        }
      },
    })

    // 切章或外部恢复草稿时复用同一编辑器实例
    const lastChapterRef = useRef<string>(chapterId)
    useEffect(() => {
      if (!editor) return
      const normalized = normalizeToEditorHtml(content)
      if (lastChapterRef.current !== chapterId) {
        lastChapterRef.current = chapterId
        editor.commands.setContent(normalized, { emitUpdate: false })
        ensureParagraphIds(editor)
        return
      }
      // 外部内容变更（例如点击恢复本地草稿或版本回滚）
      const currentCanonical = canonicalBody(editor).html
      if (normalized !== currentCanonical && !editor.isFocused) {
        editor.commands.setContent(normalized, { emitUpdate: false })
        ensureParagraphIds(editor)
      }
    }, [editor, chapterId, content])

    useImperativeHandle(
      ref,
      () => ({
        getEditor: () => editor,
        undo: () => editor?.chain().focus().undo().run(),
        redo: () => editor?.chain().focus().redo().run(),
        canUndo: () => editor?.can().undo() ?? false,
        canRedo: () => editor?.can().redo() ?? false,
        toggleBold: () => editor?.chain().focus().toggleBold().run(),
        toggleItalic: () => editor?.chain().focus().toggleItalic().run(),
        toggleHeading: () =>
          editor?.chain().focus().toggleHeading({ level: 2 }).run(),
        toggleBlockquote: () =>
          editor?.chain().focus().toggleBlockquote().run(),
        toggleBulletList: () =>
          editor?.chain().focus().toggleBulletList().run(),
        autoFormat: () => {
          if (!editor) return
          const { tr } = editor.state
          const replacements: Array<{ from: number; to: number; text: string }> = []
          const emptyPositions: Array<{ from: number; to: number }> = []

          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'aiDraft') return false
            if (node.type.name === 'paragraph') {
              const raw = node.textContent
              const cleaned = raw.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '')
              if (!cleaned && editor.state.doc.childCount > 1) {
                emptyPositions.push({ from: pos, to: pos + node.nodeSize })
              } else if (cleaned !== raw && node.childCount === 1 && node.firstChild?.isText) {
                replacements.push({
                  from: pos + 1,
                  to: pos + node.nodeSize - 1,
                  text: cleaned,
                })
              }
            }
          })

          // 先替换文本再从后往前删除空段，保证位置准确
          for (const r of replacements.reverse()) {
            tr.insertText(r.text, r.from, r.to)
          }
          for (const e of emptyPositions.reverse()) {
            tr.delete(e.from, e.to)
          }
          if (replacements.length > 0 || emptyPositions.length > 0) {
            editor.view.dispatch(tr)
          }
        },
        replaceSelection: (text: string) => {
          if (!editor) return
          const paragraphs = text
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => ({
              type: 'paragraph',
              ...(line ? { content: [{ type: 'text', text: line }] } : {}),
            }))
          editor.chain().focus().insertContent(paragraphs).run()
        },
        replaceAllContent: (text: string) => {
          if (!editor) return
          const html = text.trim().startsWith('<') ? text : formatPlainToNovelHtml(text)
          editor.commands.setContent(html, { emitUpdate: true })
          ensureParagraphIds(editor)
        },
        startAiDraftStream: (runId?: string) => {
          if (!editor) return
          editor.chain().focus().insertAiDraft().run()
          if (runId) editor.commands.setDraftRunId(runId)
        },
        appendAiDraftChunk: (text: string) => {
          editor?.commands.appendDraftText(text)
        },
        finishAiDraftStream: () => {
          editor?.commands.setDraftStatus('pending')
        },
        insertAiDraftBlock: (text: string, runId?: string) => {
          if (!editor) return
          editor.chain().focus().insertPersistedDraft({
            id: `draft-${Date.now()}`,
            runId: runId ?? `ai-${Date.now()}`,
            content: text,
          }).run()
        },
      }),
      [editor]
    )

    const typeIcon = (type: CodexItem['type']) => {
      if (type === 'character') return <Users className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
      if (type === 'worldview') return <MapIcon className="h-3.5 w-3.5 text-emerald-500" />
      return <Sword className="h-3.5 w-3.5 text-amber-500" />
    }

    return (
      <CodexMapContext.Provider value={codexMap}>
        <div
          className={`novel-paper-wrap relative h-full w-full overflow-y-auto px-2 sm:px-6 ${
            indent ? 'tiptap-indent' : ''
          } ${editorMode === 'typewriter' ? 'typewriter-mode' : ''} ${
            editorMode === 'focus' ? 'focus-mode' : ''
          }`}
          style={{
            fontFamily: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, serif',
            fontSize: `${fontSize}px`,
          }}
        >
          <div className="novel-paper-sheet">
            <EditorContent editor={editor} className="min-h-full" />
          </div>

          {/* @ 设定联想下拉 */}
          {suggest.open && suggest.items.length > 0 && (
            <div
              className="fixed z-50 w-64 rounded-md border border-border bg-popover p-1 shadow-lg"
              style={{
                left: Math.min(suggest.rect.left, window.innerWidth - 270),
                top: Math.min(suggest.rect.top, window.innerHeight - 260),
              }}
            >
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                选择设定条目（引用 ID，改名自动跟随）
              </div>
              {suggest.items.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    suggest.select(idx)
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    idx === suggest.index
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  {typeIcon(item.type)}
                  <span className="truncate font-medium">{item.name}</span>
                  {item.summary && (
                    <span className="ml-auto truncate max-w-[100px] text-[10px] text-muted-foreground">
                      {item.summary}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </CodexMapContext.Provider>
    )
  }
)
