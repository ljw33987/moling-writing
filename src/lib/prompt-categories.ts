/** 提示词模板市场分类（前后端共用，避免两处维护不一致） */
export const PROMPT_CATEGORIES = [
  '开篇钩子',
  '大纲模板',
  '人物设定',
  '爽点打磨',
  '去AI味',
  '对话张力',
] as const

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]
