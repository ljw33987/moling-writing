import type { AgentRoleId } from './multi-agent-writing'

interface WritingSkill {
  id: string
  name: string
  summary: string
  recommendedAgents: AgentRoleId[]
  rules: string[]
}

// 部分写作手法参考 OpenFicM、oh-story 和 Lorn，按项目内的写作任务重新归并。
export const WRITING_SKILLS: WritingSkill[] = [
  {
    id: 'character_design',
    name: '人物与关系',
    summary: '检查人物欲望、行动动机、关系变化和反派逻辑。',
    recommendedAgents: ['build', 'plan', 'composer', 'writer', 'character_designer'],
    rules: [
      '关键人物的选择应符合目标、软肋、底线和已知信息。人物关系的变化应由具体事件推动。',
      '适用时检查反派行动的利益与代价。揭露秘密应改变后续选择或双方筹码。',
    ],
  },
  {
    id: 'dialogue_design',
    name: '对白与角色声线',
    summary: '让台词符合人物身份、关系和当下目的。',
    recommendedAgents: ['composer', 'writer', 'actor'],
    rules: [
      '沿用已建立的角色称谓、词汇和说话习惯。让试探、回避或直说符合场景目的。',
      '需要表现态度变化时，可用动作、停顿或话题转换承接，遵循本次文风的叙事密度。',
    ],
  },
  {
    id: 'story_hooks',
    name: '剧情节奏与钩子',
    summary: '合并开篇、情绪递进、反转、章末悬念和阶段规划。',
    recommendedAgents: ['build', 'plan', 'composer', 'writer', 'reviewer'],
    rules: [
      '开篇围绕当下的麻烦、抉择或反常展开；需要悬念时，用未完成行动、信息差或代价承接下一段。',
      '情绪转折要有触发点，反转要有前置线索和后果。分卷规划时，给每个阶段设置目标、阶段兑现和下一阶段承接点。',
    ],
  },
  {
    id: 'short_submission_structure',
    name: '短篇结构',
    summary: '用于明确的短篇创作或投稿，集中核心冲突与结尾兑现。',
    recommendedAgents: ['build', 'plan', 'composer', 'writer'],
    rules: [
      '仅用于短篇任务。尽早交代冲突，集中有限人物与场景，将铺垫、反转和兑现安排在完整篇幅内。',
      '按作者选择的视角与平台要求组织结构。',
    ],
  },
  {
    id: 'structure_deconstruct',
    name: '长短篇拆解',
    summary: '从样文提炼冲突、信息投放和情绪节奏。',
    recommendedAgents: ['explore', 'plan', 'reviewer'],
    rules: [
      '拆解长篇时关注卷章层级、开局承诺及持续兑现；拆解短篇时关注导语、铺垫、反转与结尾。',
      '引用文本证据，提炼可复用的结构和节奏。',
    ],
  },
  {
    id: 'story_state_tracking',
    name: '设定连续性与提取',
    summary: '核对人物状态、时间线、道具与伏笔，识别可确认的新设定。',
    recommendedAgents: ['explore', 'auditor', 'extractor'],
    rules: [
      '区分正文已发生的事实、计划中的情节与尚未确认的信息。只保留当前任务相关的状态。',
      '设定提取以正文为依据；一致性检查指出冲突及证据位置。',
    ],
  },
  {
    id: 'webnovel_quality_rubric',
    name: '审稿与读者预期',
    summary: '从读者体验、编辑判断和设定逻辑核对问题。',
    recommendedAgents: ['auditor', 'reviewer'],
    rules: [
      '核对主角的选择与代价、核心期待是否兑现，以及每场戏是否推进剧情或人物关系。',
      '结合题材和目标读者判断节奏，区分有意留白与信息缺失。证据不足时标明待确认。',
    ],
  },
  {
    id: 'de_template_revision',
    name: '表达精修',
    summary: '处理模板感、机械过渡和无依据的情绪跳转。',
    recommendedAgents: ['actor', 'reviewer'],
    rules: [
      '按本次文风辨别机械重复、生硬衔接与角色腔调漂移，保留符合本次风格要求的句式、修辞和节奏。',
      '审核任务定位问题，改写任务在本次要求的范围内调整表达；剧情因果疑点交给作者判断。',
    ],
  },
]

export const CHAPTER_REVIEW_DIMENSIONS = '开篇吸引力、节奏推进、人物口吻与动机、冲突及期待感、逻辑与设定一致性'

const SKILL_ALIASES = new Map<string, string>([
  ['character_relations', 'character_design'],
  ['villain_and_truth_reveal', 'character_design'],
  ['opening_design', 'story_hooks'],
  ['emotional_arc', 'story_hooks'],
  ['reversal_design', 'story_hooks'],
  ['oh_long_novel_routing', 'story_hooks'],
  ['oh_short_fiction', 'short_submission_structure'],
  ['oh_long_deconstruct', 'structure_deconstruct'],
  ['oh_short_deconstruct', 'structure_deconstruct'],
  ['oh_import_existing', 'story_state_tracking'],
  ['reader_contract_audit', 'webnovel_quality_rubric'],
  ['oh_adversarial_review', 'webnovel_quality_rubric'],
  ['banned_words_check', 'de_template_revision'],
  ['oh_de_ai_three_layers', 'de_template_revision'],
  ['lorn_style_evolution', 'de_template_revision'],
])

const SKILLS_BY_ID = new Map(WRITING_SKILLS.map((skill) => [skill.id, skill]))

const AGENT_DEFAULT_SKILLS: Record<AgentRoleId, readonly string[]> = {
  build: [],
  explore: ['story_state_tracking'],
  plan: ['story_hooks'],
  composer: ['story_hooks'],
  auditor: ['story_state_tracking', 'webnovel_quality_rubric'],
  writer: ['dialogue_design'],
  actor: ['de_template_revision'],
  reviewer: ['webnovel_quality_rubric'],
  extractor: ['story_state_tracking'],
  character_designer: ['character_design'],
}

const TASK_SKILLS: Record<string, AgentRoleId> = {
  chapter_gen: 'writer',
  continue: 'writer',
  polish: 'actor',
  expand: 'writer',
  shorten: 'actor',
  style_change: 'actor',
  char_dialogue: 'writer',
  editor_review: 'reviewer',
  poison_check: 'auditor',
  gen_character: 'character_designer',
  xuanhuan: 'writer',
  yanqing: 'writer',
}

function normalizeSkillIds(ids: readonly unknown[]): string[] {
  const normalized = new Set<string>()
  for (const value of ids) {
    if (typeof value !== 'string') continue
    const id = SKILL_ALIASES.get(value) ?? value
    if (SKILLS_BY_ID.has(id)) normalized.add(id)
  }
  return [...normalized]
}

function buildSkillInjection(
  selectedSkillIds: string[] | undefined,
  defaultIds: readonly string[],
  eligibleAgents: readonly AgentRoleId[],
) {
  const ids = normalizeSkillIds(Array.isArray(selectedSkillIds) ? selectedSkillIds : defaultIds)
  const skills = ids.flatMap((id) => {
    const skill = SKILLS_BY_ID.get(id)
    return skill?.recommendedAgents.some((agent) => eligibleAgents.includes(agent)) ? [skill] : []
  })
  if (!skills.length) return { promptBlock: '', appliedSkillNames: [] }

  const sections = skills.map(
    (skill) => `### ${skill.name}\n${skill.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`
  )
  return {
    promptBlock: `\n\n【本次任务适用的写作方法】\n以下方法按场景使用，叙述视角、口吻、句式和段落节奏以本次文风要求为准。\n${sections.join('\n\n')}`,
    appliedSkillNames: skills.map((skill) => skill.name),
  }
}

export function buildSkillInjectionPrompt(selectedSkillIds: string[] | undefined, agentId: AgentRoleId) {
  return buildSkillInjection(selectedSkillIds, AGENT_DEFAULT_SKILLS[agentId], [agentId])
}

export function buildSkillInjectionForAssistant(
  selectedSkillIds: string[] | undefined,
  mode: 'prose' | 'readonly',
  preset?: string,
  message = '',
) {
  if (preset === 'deconstruct') {
    return buildSkillInjection(selectedSkillIds, ['structure_deconstruct'], ['explore'])
  }
  if (preset === 'golden_three') {
    return buildSkillInjection(selectedSkillIds, ['story_hooks'], ['composer', 'writer'])
  }
  const presetAgent = preset && Object.hasOwn(TASK_SKILLS, preset) ? TASK_SKILLS[preset] : undefined
  const agent = presetAgent ?? (
    mode === 'prose'
      ? /润色|改写|重写|去\s*AI\s*味|\b(?:rewrite|revise)\b/i.test(message) ? 'actor' : 'writer'
      : /审稿|审校|点评|评分|\b(?:review|critique)\b/i.test(message) ? 'reviewer'
      : /一致性|查错|设定冲突|吃书|\baudit\b/i.test(message) ? 'auditor'
      : undefined
  )
  if (agent) return buildSkillInjectionPrompt(selectedSkillIds, agent)

  return buildSkillInjection(selectedSkillIds, [], ['explore', 'auditor', 'reviewer'])
}

function getSkillStorageKey(novelId: string) {
  return `moling_writing_skills_${novelId}`
}

export function getStoredSkillIds(novelId: string): string[] | undefined {
  if (typeof window === 'undefined') return
  try {
    const saved = JSON.parse(localStorage.getItem(getSkillStorageKey(novelId)) ?? 'null')
    if (Array.isArray(saved)) return normalizeSkillIds(saved)
  } catch {}
}

export function saveStoredSkillIds(novelId: string, skillIds: string[] | undefined) {
  if (typeof window === 'undefined') return
  try {
    const key = getSkillStorageKey(novelId)
    if (skillIds === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(normalizeSkillIds(skillIds)))
  } catch {}
}
