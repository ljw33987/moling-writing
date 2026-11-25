'use client'

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useCodexItem } from './codex-context'

export function CodexRefChip({ node }: NodeViewProps) {
  const id = (node.attrs.id as string) || ''
  const entry = useCodexItem(id)
  const label = entry?.name ?? '未知设定'

  return (
    <NodeViewWrapper
      as="span"
      className="codex-ref inline-block cursor-pointer whitespace-nowrap border-b-2 border-violet-400/70 px-0.5 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300 data-[missing=true]:border-muted-foreground data-[missing=true]:text-muted-foreground"
      data-missing={!entry}
      title={entry?.summary ?? '该设定条目已删除或尚未加载'}
    >
      @{label}
    </NodeViewWrapper>
  )
}
