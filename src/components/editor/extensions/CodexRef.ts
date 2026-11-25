import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodexRefChip } from './CodexRefChip'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codexRef: {
      insertCodexRef: (id: string) => ReturnType
    }
  }
}

/**
 * 设定引用节点（移植自墨枢 Moshu）：
 * 存的是条目 id，不是纯文字 —— 条目改名后正文自动跟随，
 * 且服务端可精确解析本章引用了哪些设定。
 */
export const CodexRef = Node.create({
  name: 'codexRef',
  inline: true,
  group: 'inline',
  atom: true,

  addAttributes() {
    return { id: { default: '' } }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-codex-ref]',
        getAttrs: (el) => ({
          id: (el as HTMLElement).getAttribute('data-codex-ref'),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-codex-ref': HTMLAttributes.id })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodexRefChip)
  },

  addCommands() {
    return {
      insertCodexRef:
        (id) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { id } },
            { type: 'text', text: ' ' },
          ]),
    }
  },
})
