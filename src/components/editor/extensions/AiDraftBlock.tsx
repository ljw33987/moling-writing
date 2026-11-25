'use client'

import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import type { DraftStatus } from './AiDraft'

export function AiDraftBlock({ node, getPos, editor, updateAttributes }: NodeViewProps) {
  const status = (node.attrs.status as DraftStatus) || 'pending'
  const labelText =
    status === 'streaming' ? '正在写入' : status === 'locked' ? '已锁定' : '待采纳'

  const accept = () => {
    const pos = getPos()
    if (pos === undefined) return
    editor.chain().focus().acceptDraftAt(pos).run()
  }

  const reject = () => {
    const pos = getPos()
    if (pos === undefined) return
    editor.chain().focus().rejectDraftAt(pos).run()
  }

  const toggleLock = () => {
    updateAttributes({ status: status === 'locked' ? 'pending' : 'locked' })
  }

  return (
    <NodeViewWrapper
      className="ai-draft my-3 rounded-r-md border-l-4 border-teal- bg-teal-600/5 py-2 pl-4 pr-3 data-[status=locked]:border-muted-foreground"
      data-status={status}
    >
      <div
        className="ai-draft-bar mb-2 flex items-center justify-between gap-3 text-xs select-none"
        contentEditable={false}
      >
        <span
          className="ai-draft-label font-semibold tracking-wider text-teal- dark:text-teal-"
          aria-live="polite"
        >
          {labelText}
        </span>
        {status === 'streaming' ? (
          <span className="text-muted-foreground" aria-live="polite">
            生成中，可随时停止
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={accept}
              className="rounded border border-teal-/40 bg-teal-600/15 px-2 py-0.5 text-xs font-medium text-teal- hover:bg-teal-600/25 dark:text-teal-"
            >
              采纳
            </button>
            <button
              type="button"
              onClick={reject}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              丢弃
            </button>
            <button
              type="button"
              onClick={toggleLock}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {status === 'locked' ? '解锁' : '锁定'}
            </button>
          </div>
        )}
      </div>
      <NodeViewContent className="ai-draft-content" />
    </NodeViewWrapper>
  )
}
