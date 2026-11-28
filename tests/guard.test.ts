import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- mock @/lib/db（在导入被测模块前完成）----
type ChapterRow = {
  id: string
  title: string
  content: string
  summary: string | null
  sortOrder: number
}
type CharacterRow = { id: string; name: string }
type ItemRow = { id: string }

const state = {
  chapters: [] as ChapterRow[],
  characters: [] as CharacterRow[],
  worldviews: [] as Array<{ id: string }>,
  items: [] as ItemRow[],
  createdIssues: [] as any[],
  shouldThrow: false,
}

function resetState() {
  state.chapters = []
  state.characters = []
  state.worldviews = []
  state.items = []
  state.createdIssues = []
  state.shouldThrow = false
}

mock.module('@/lib/db', () => ({
  db: {
    chapter: {
      findMany: async ({ where }: any) => {
        if (state.shouldThrow) throw new Error('db down')
        let rows = state.chapters
        if (where?.id?.in) rows = rows.filter((c) => where.id.in.includes(c.id))
        return [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
      },
    },
    character: {
      findMany: async () => {
        if (state.shouldThrow) throw new Error('db down')
        return state.characters.map((c) => ({ ...c }))
      },
    },
    worldview: {
      findMany: async () => {
        if (state.shouldThrow) throw new Error('db down')
        return state.worldviews.map((w) => ({ ...w }))
      },
    },
    item: {
      findMany: async () => {
        if (state.shouldThrow) throw new Error('db down')
        return state.items.map((i) => ({ ...i }))
      },
    },
    consistencyIssue: {
      createMany: async ({ data }: any) => {
        state.createdIssues.push(...data)
        return { count: data.length }
      },
    },
  },
}))

const { collectGuardIssues, recordGuardIssues, runChapterGuardSafely } = await import(
  '../src/lib/guard'
)

const NOVEL = 'novel-1'
const LONG_TEXT = '很'.repeat(600) // >500 字

describe('collectGuardIssues', () => {
  beforeEach(resetState)

  test('检测 @ 引用失效（codex error）', async () => {
    state.chapters = [
      {
        id: 'ch-1',
        title: '第一章',
        content: `<p><span data-codex-ref="deleted-id">张三</span>${LONG_TEXT}</p>`,
        summary: '有摘要',
        sortOrder: 0,
      },
    ]
    const issues = await collectGuardIssues(NOVEL)
    const codex = issues.filter((i) => i.category === 'codex')
    expect(codex.length).toBe(1)
    expect(codex[0].severity).toBe('error')
    expect(codex[0].chapterId).toBe('ch-1')
    expect(codex[0].detail).toContain('deleted-id')
  })

  test('有效 @ 引用不产生告警', async () => {
    state.chapters = [
      {
        id: 'ch-1',
        title: '第一章',
        content: `<p><span data-codex-ref="char-1">张三</span>${LONG_TEXT}</p>`,
        summary: '有摘要',
        sortOrder: 0,
      },
    ]
    state.characters = [{ id: 'char-1', name: '张三' }]
    const issues = await collectGuardIssues(NOVEL)
    expect(issues.filter((i) => i.category === 'codex').length).toBe(0)
  })

  test('超过 500 字且无摘要 → info 告警；短章节不告警', async () => {
    state.chapters = [
      { id: 'ch-long', title: '长章', content: `<p>${LONG_TEXT}</p>`, summary: null, sortOrder: 0 },
      { id: 'ch-short', title: '短章', content: '<p>很短</p>', summary: null, sortOrder: 1 },
    ]
    const issues = await collectGuardIssues(NOVEL)
    const summaryIssues = issues.filter((i) => i.title.includes('尚未填写章节摘要'))
    expect(summaryIssues.length).toBe(1)
    expect(summaryIssues[0].chapterId).toBe('ch-long')
    expect(summaryIssues[0].severity).toBe('info')
  })

  test('同名角色仅全书巡检（novel scope）报 warning，单章 scope 不报', async () => {
    state.characters = [
      { id: 'c1', name: '张三' },
      { id: 'c2', name: '张三' },
    ]
    state.chapters = []
    const novelIssues = await collectGuardIssues(NOVEL, { scope: 'novel' })
    expect(novelIssues.filter((i) => i.category === 'character').length).toBe(1)

    const chapterIssues = await collectGuardIssues(NOVEL, {
      scope: 'chapter',
      chapterIds: [],
    })
    expect(chapterIssues.filter((i) => i.category === 'character').length).toBe(0)
  })

  test('chapterIds 过滤只检查指定章节', async () => {
    state.chapters = [
      { id: 'ch-a', title: 'A', content: `<p>x</p>`, summary: null, sortOrder: 0 },
      { id: 'ch-b', title: 'B', content: `<p>${LONG_TEXT}</p>`, summary: null, sortOrder: 1 },
    ]
    const issues = await collectGuardIssues(NOVEL, {
      scope: 'chapter',
      chapterIds: ['ch-b'],
    })
    // 只检查 ch-b：摘要缺失 1 条，ch-a 的无摘要短章不计
    expect(issues.every((i) => i.chapterId === 'ch-b')).toBe(true)
    expect(issues.length).toBe(1)
  })
})

describe('recordGuardIssues / runChapterGuardSafely', () => {
  beforeEach(resetState)

  test('recordGuardIssues 落库（空数组不写）', async () => {
    await recordGuardIssues([])
    expect(state.createdIssues.length).toBe(0)

    await recordGuardIssues([
      {
        novelId: NOVEL,
        chapterId: null,
        category: 'logic',
        severity: 'warning',
        title: 't',
        detail: 'd',
      },
    ])
    expect(state.createdIssues.length).toBe(1)
  })

  test('runChapterGuardSafely 正常收集并落库，返回告警数', async () => {
    state.chapters = [
      { id: 'ch-1', title: '第一章', content: `<p>${LONG_TEXT}</p>`, summary: null, sortOrder: 0 },
    ]
    const count = await runChapterGuardSafely(NOVEL, 'ch-1', '第一章')
    expect(count).toBe(1)
    expect(state.createdIssues.length).toBe(1)
  })

  test('db 异常时吞掉错误返回 0（不阻塞主流程）', async () => {
    state.shouldThrow = true
    const count = await runChapterGuardSafely(NOVEL, 'ch-1')
    expect(count).toBe(0)
    expect(state.createdIssues.length).toBe(0)
  })
})
