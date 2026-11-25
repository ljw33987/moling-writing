import { Extension } from '@tiptap/core'

/**
 * 段落级 AI 溯源属性（移植自墨枢 Moshu）：
 * 标记由 AI 草稿采纳进入正文的段落，用于后续 AI 占比统计与自然化审查。
 */
export const Provenance = Extension.create({
  name: 'provenance',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          aiRunId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-ai-run-id'),
            renderHTML: (attributes) =>
              attributes.aiRunId ? { 'data-ai-run-id': attributes.aiRunId } : {},
          },
          aiSourceHash: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-ai-source-hash'),
            renderHTML: (attributes) =>
              attributes.aiSourceHash
                ? { 'data-ai-source-hash': attributes.aiSourceHash }
                : {},
          },
        },
      },
    ]
  },
})
