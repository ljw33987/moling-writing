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
      className="ai-draft ai-draft-surface my-3 rounded-r-[10px] py-2.5 pl-4 pr-3 data-[status=locked]:border-muted-foreground"
      data-status={status}
    >
      <div
        className="ai-draft-bar mb-2 flex items-center justify-between gap-3 text-xs select-none"
        contentEditable={false}
      >
        <span
          className="ai-draft-label inline-flex items-center gap-1.5 font-semibold tracking-wide text-[var(--violet)]"
          aria-live="polite"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#4F46E5] to-[#7C3AED]" />
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
              className="rounded-[7px] border border-[var(--brand-line)] bg-[var(--brand-soft)] px-2.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              采纳
            </button>
            <button
              type="button"
              onClick={reject}
              className="rounded-[7px] border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              丢弃
            </button>
            <button
              type="button"
              onClick={toggleLock}
              className="rounded-[7px] border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
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
