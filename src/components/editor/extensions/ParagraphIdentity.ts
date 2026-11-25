import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

const LOCATABLE = new Set(['paragraph', 'heading', 'listItem'])

function freshParagraphId() {
  return `p-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

/**
 * 为段落/标题/列表项维护唯一稳定的 data-paragraph-id（移植自墨枢 Moshu）。
 */
export const ParagraphIdentity = Extension.create({
  name: 'paragraphIdentity',

  addGlobalAttributes() {
    return [
      {
        types: [...LOCATABLE],
        attributes: {
          pid: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-paragraph-id'),
            renderHTML: (attributes) =>
              attributes.pid ? { 'data-paragraph-id': String(attributes.pid) } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const seen = new Set<string>()
          let changed = false
          const tr = newState.tr
          newState.doc.descendants((node, pos) => {
            if (!LOCATABLE.has(node.type.name)) return
            const existing =
              typeof node.attrs.pid === 'string' ? node.attrs.pid.trim() : ''
            const pid =
              existing && !seen.has(existing) ? existing : freshParagraphId()
            seen.add(pid)
            if (pid !== existing) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, pid })
              changed = true
            }
          })
          return changed ? tr.setMeta('addToHistory', false) : null
        },
      }),
    ]
  },
})

export function ensureParagraphIds(editor: Editor) {
  const seen = new Set<string>()
  let blockIndex = 0
  let changed = false
  const tr = editor.state.tr
  editor.state.doc.descendants((node, pos) => {
    if (!LOCATABLE.has(node.type.name)) return
    const existing =
      typeof node.attrs.pid === 'string' ? node.attrs.pid.trim() : ''
    let pid = existing && !seen.has(existing) ? existing : `p-${blockIndex}`
    if (seen.has(pid)) pid = freshParagraphId()
    seen.add(pid)
    blockIndex += 1
    if (pid !== existing) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, pid })
      changed = true
    }
  })
  if (changed) editor.view.dispatch(tr.setMeta('addToHistory', false))
}
