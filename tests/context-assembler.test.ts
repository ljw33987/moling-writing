import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- mock @/lib/db（在导入被测模块前完成）----
const state = {
  novel: null as any,
  characters: [] as any[],
  worldviews: [] as any[],
  items: [] as any[],
  chapters: [] as any[],
  timelineEvents: [] as any[],
  foreshadowings: [] as any[],
}

function resetState() {
  state.novel = null
  state.characters = []
  state.worldviews = []
  state.items = []
  state.chapters = []
  state.timelineEvents = []
  state.foreshadowings = []
}

mock.module('@/lib/db', () => ({
  db: {
    novel: { findUnique: async () => state.novel },
    character: { findMany: async () => state.characters },
    worldview: { findMany: async () => state.worldviews },
    item: { findMany: async () => state.items },
    chapter: {
      findUnique: async ({ where }: any) =>
        state.chapters.find((c) => c.id === where.id) || null,
      findMany: async () =>
        [...state.chapters].sort((a, b) => a.sortOrder - b.sortOrder),
    },
    timelineEvent: { findMany: async () => state.timelineEvents },
    foreshadowing: { findMany: async () => state.foreshadowings },
  },
}))

const { estimateTokens, extractCodexRefIds, assembleNovelContext } = await import(
  '../src/lib/context-assembler'
)

function seedNovel(overrides: Record<string, any> = {}) {
  state.novel = {
    id: 'novel-1',
    userId: 'user-1',
    title: '测试书',
    genre: '玄幻',
    synopsis: '一个测试简介',
    outline: '## 主线\n主角崛起',
    ...overrides,
  }
}

describe('estimateTokens', () => {
  test('CJK 按 0.75、其他按 0.3 估算并向上取整', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('测试中文')).toBe(Math.ceil(4 * 0.75))
    expect(estimateTokens('abcd')).toBe(Math.ceil(4 * 0.3))
    expect(estimateTokens('中a')).toBe(Math.ceil(1 * 0.75 + 1 * 0.3))
  })
})

describe('extractCodexRefIds', () => {
  test('提取并去重 data-codex-ref', () => {
    const html =
      '<p><span data-codex-ref="a">x</span></p><div data-codex-ref=\'b\'></div><span data-codex-ref="a">y</span>'
    expect(extractCodexRefIds(html)).toEqual(['a', 'b'])
  })
  test('空内容返回空数组', () => {
    expect(extractCodexRefIds('')).toEqual([])
    expect(extractCodexRefIds('<p>无引用</p>')).toEqual([])
  })
})

describe('assembleNovelContext', () => {
  beforeEach(resetState)

  test('装配层顺序正确且总量不超过预算', async () => {
    seedNovel()
    state.timelineEvents = [
      { timeLabel: '第一天', title: '开篇事件', description: null },
    ]
    state.foreshadowings = [
      { id: 'f1', title: '神秘令牌', description: null, status: 'planted', plantedChapter: 1 },
    ]
    state.chapters = [
      { id: 'ch-1', title: '第一章', summary: '开篇', sortOrder: 0, volumeId: 'v1', content: '' },
    ]
    const result = await assembleNovelContext({ novelId: 'novel-1', budgetTokens: 4000 })
    const keys = result.layers.map((l) => l.key)
    expect(keys[0]).toBe('outline')
    const tlIdx = keys.indexOf('timeline')
    const fsIdx = keys.indexOf('foreshadowing')
    expect(tlIdx).toBeGreaterThan(-1)
    expect(fsIdx).toBe(tlIdx + 1)
    expect(result.totalTokens).toBeLessThanOrEqual(4000)
    expect(result.contextText).toContain('测试书')
  })

  test('活跃伏笔层注入标题与状态提示', async () => {
    seedNovel()
    state.foreshadowings = [
      {
        id: 'f1',
        title: '玄铁令的来历',
        description: '第一章捡到的令牌',
        status: 'planted',
        plantedChapter: 1,
      },
      {
        id: 'f2',
        title: '师尊失踪之谜',
        description: null,
        status: 'advanced',
        plantedChapter: 3,
      },
    ]
    const result = await assembleNovelContext({ novelId: 'novel-1', budgetTokens: 4000 })
    const fsLayer = result.layers.find((l) => l.key === 'foreshadowing')
    expect(fsLayer).toBeDefined()
    expect(fsLayer!.itemCount).toBe(2)
    expect(fsLayer!.preview).toContain('玄铁令的来历')
    expect(fsLayer!.preview).toContain('已埋设·待推进')
    expect(fsLayer!.preview).toContain('推进中')
  })

  test('设定池对齐：同作者全局设定（novelId=null）参与装配', async () => {
    seedNovel()
    state.characters = [
      { id: 'c-local', name: '本书角色', novelId: 'novel-1', personality: '沉稳' },
      { id: 'c-global', name: '全局角色', novelId: null, personality: '暴躁' },
    ]
    state.chapters = [
      { id: 'ch-1', title: '第一章', summary: '开篇', sortOrder: 0, volumeId: 'v1', content: '' },
    ]
    const result = await assembleNovelContext({ novelId: 'novel-1', budgetTokens: 8000 })
    expect(result.contextText).toContain('全局角色')
    expect(result.contextText).toContain('本书角色')
  })

  test('失效 @ 引用进入 missingCodexIds 并产生警告', async () => {
    seedNovel()
    state.characters = [{ id: 'c-1', name: '张三', novelId: 'novel-1' }]
    state.chapters = [
      {
        id: 'ch-1',
        title: '第一章',
        summary: null,
        sortOrder: 0,
        volumeId: 'v1',
        content: '<p><span data-codex-ref="c-1">张三</span><span data-codex-ref="c-gone">亡者</span></p>',
      },
    ]
    const result = await assembleNovelContext({
      novelId: 'novel-1',
      chapterId: 'ch-1',
      budgetTokens: 4000,
    })
    expect(result.referencedCodexIds).toContain('c-1')
    expect(result.missingCodexIds).toEqual(['c-gone'])
    expect(result.preflight.status).toBe('attention')
    expect(result.preflight.warnings.some((w) => w.includes('@ 引用'))).toBe(true)
  })

  test('未传 chapterId（自动连载场景）仍有大纲层且不出现前情摘要层', async () => {
    seedNovel()
    state.chapters = [
      { id: 'ch-1', title: '第一章', summary: '开篇', sortOrder: 0, volumeId: 'v1', content: '' },
    ]
    const result = await assembleNovelContext({ novelId: 'novel-1', budgetTokens: 4000 })
    const keys = result.layers.map((l) => l.key)
    expect(keys).toContain('outline')
    expect(keys).not.toContain('previous_summary')
    expect(keys).not.toContain('recent_body')
  })

  test('小说不存在时返回空装配', async () => {
    const result = await assembleNovelContext({ novelId: 'no-such' })
    expect(result.layers.length).toBe(0)
    expect(result.contextText).toBe('')
  })
})
