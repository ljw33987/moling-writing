import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { CodexItem } from './codex-context'

export interface CodexSuggestState {
  open: boolean
  items: CodexItem[]
  index: number
  rect: { left: number; top: number }
  select: (index: number) => void
}

export function createCodexSuggestion(
  search: (q: string) => CodexItem[],
  onStateChange: (updater: (prev: CodexSuggestState) => CodexSuggestState) => void
) {
  return Extension.create({
    name: 'codexSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '@',
          allowSpaces: false,
          items: ({ query }) => search(query),
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertCodexRef((props as CodexItem).id)
              .run()
          },
          render: () => {
            let currentItems: CodexItem[] = []
            let currentIndex = 0
            let selectFn: (i: number) => void = () => {}

            return {
              onStart: (p) => {
                currentItems = p.items as CodexItem[]
                currentIndex = 0
                selectFn = (i) => {
                  const item = currentItems[i]
                  if (item) p.command(item)
                }
                const r = p.clientRect?.()
                onStateChange((prev) => ({
                  ...prev,
                  items: currentItems,
                  index: 0,
                  open: currentItems.length > 0,
                  rect: r ? { left: r.left, top: r.bottom + 6 } : prev.rect,
                  select: selectFn,
                }))
              },
              onUpdate: (p) => {
                currentItems = p.items as CodexItem[]
                if (currentIndex >= currentItems.length) currentIndex = 0
                selectFn = (i) => {
                  const item = currentItems[i]
                  if (item) p.command(item)
                }
                const r = p.clientRect?.()
                onStateChange((prev) => ({
                  ...prev,
                  items: currentItems,
                  index: currentIndex,
                  open: currentItems.length > 0,
                  rect: r ? { left: r.left, top: r.bottom + 6 } : prev.rect,
                  select: selectFn,
                }))
              },
              onKeyDown: (p) => {
                const n = currentItems.length
                if (!n) return false
                if (p.event.key === 'ArrowDown') {
                  currentIndex = (currentIndex + 1) % n
                  onStateChange((prev) => ({ ...prev, index: currentIndex }))
                  return true
                }
                if (p.event.key === 'ArrowUp') {
                  currentIndex = (currentIndex - 1 + n) % n
                  onStateChange((prev) => ({ ...prev, index: currentIndex }))
                  return true
                }
                if (p.event.key === 'Enter') {
                  selectFn(currentIndex)
                  return true
                }
                if (p.event.key === 'Escape') {
                  onStateChange((prev) => ({ ...prev, open: false }))
                  return true
                }
                return false
              },
              onExit: () => {
                onStateChange((prev) => ({ ...prev, open: false }))
              },
            }
          },
        }),
      ]
    },
  })
}
