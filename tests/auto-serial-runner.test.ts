import { describe, test, expect, mock, beforeEach } from 'bun:test'

/**
 * auto-serial-runner 单测：mock 数据库与 AI 调用。
 * 覆盖：成功生成（标题/正文解析、守卫与记忆沉淀被调用、Token 扣除）、
 * 字数不足自动重试 1 次、AI 全部失败时任务标记 error。
 */

// ---- mock @/lib/db ----
const dbState = {
  task: null as any,
  user: null as any,
  novel: null as any,
  chapters: [] as any[],
  createdChapters: [] as any[],
  autoSerialUpdates: [] as any[],
  tokenDeductions: [] as any[],
  totalWordsUpdates: [] as any[],
}

function resetDbState() {
  dbState.task = {
    id: 'task-1',
    novelId: 'novel-1',
    userId: 'user-1',
    enabled: true,
    intervalMin: 60,
    targetWords: 2000,
    totalGenerated: 0,
    status: 'idle',
    lastError: null,
    plotDirection: null,
  }
  dbState.user = { id: 'user-1', tokens: 100000 }
  dbState.novel = {
    id: 'novel-1',
    userId: 'user-1',
    title: '测试书',
    genre: '玄幻',
    synopsis: '简介',
    outline: '大纲',
    totalWords: 1000,
    volumes: [{ id: 'vol-1', sortOrder: 0, isOutline: false }],
    chapters: [],
  }
  dbState.chapters = []
  dbState.createdChapters = []
  dbState.autoSerialUpdates = []
  dbState.tokenDeductions = []
  dbState.totalWordsUpdates = []
}

const chapterCreateData: any[] = []

mock.module('@/lib/db', () => ({
  db: {
    autoSerial: {
      findUnique: async () => dbState.task,
      update: async ({ where, data }: any) => {
        dbState.autoSerialUpdates.push({ id: where?.id, data })
        return { ...dbState.task, ...data }
      },
    },
    user: {
      findUnique: async () => dbState.user,
      updateMany: async ({ where, data }: any) => {
        dbState.tokenDeductions.push({ where, data })
        return { count: 1 }
      },
      update: async () => ({}),
    },
    novel: {
      findUnique: async () => dbState.novel,
      update: async ({ data }: any) => {
        dbState.totalWordsUpdates.push(data)
        return dbState.novel
      },
    },
    volume: {
      create: async ({ data }: any) => ({ id: 'vol-new', ...data }),
    },
    chapter: {
      count: async () => dbState.chapters.length,
      aggregate: async () => ({ _max: { sortOrder: -1 } }),
      findUnique: async () => null,
      findMany: async () => dbState.chapters,
      create: async ({ data }: any) => {
        chapterCreateData.push(data)
        const created = { id: `ch-${chapterCreateData.length}`, ...data }
        dbState.createdChapters.push(created)
        return created
      },
    },
    character: { findMany: async () => [] },
    worldview: { findMany: async () => [] },
    item: { findMany: async () => [] },
    timelineEvent: { findMany: async () => [] },
    foreshadowing: { findMany: async () => [] },
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    $executeRawUnsafe: async () => 1,
  },
}))

// ---- mock @/lib/platform-ai ----
const aiState = {
  candidates: [{ id: 'cfg-1', name: '测试接口', baseUrl: 'https://ai.test', apiKey: 'sk-test', model: 'test-model' }],
  queue: [] as string[],
  calls: [] as Array<{ system: string; userLen: number }>,
  failAll: false,
}

function resetAiState() {
  aiState.queue = []
  aiState.calls = []
  aiState.failAll = false
}

mock.module('@/lib/platform-ai', () => ({
  getPlatformConfig: async () => ({}),
  getPlatformAiCandidates: async () => aiState.candidates,
  callThirdPartyAIWithFallback: async (
    _candidates: any,
    messages: Array<{ role: string; content: string }>,
    _options?: any
  ) => {
    const system = messages[0]?.content || ''
    aiState.calls.push({ system, userLen: messages[1]?.content?.length || 0 })
    if (aiState.failAll) return { ok: false, error: '接口不可用' }
    // 去AI味精修 pass：统一返回失败（不改动正文，便于字数断言）
    if (system.includes('去AI味')) return { ok: false, error: '精修失败（mock）' }
    const reply = aiState.queue.shift()
    if (reply === undefined) return { ok: false, error: '队列耗尽（mock）' }
    return { ok: true, reply }
  },
}))

// ---- mock @/lib/ai-models ----
mock.module('@/lib/ai-models', () => ({
  parseModelMappings: () => [],
}))

// ---- mock @/lib/writing-style ----
mock.module('@/lib/writing-style', () => ({
  resolveWritingStyleForNovel: async () => null,
  buildWritingStyleInstruction: () => '',
  PROSE_REFINEMENT_RULES: 'RULES',
  PROSE_FINAL_AUDIT_RULES: 'AUDIT',
}))

// ---- mock z-ai-web-dev-sdk ----
mock.module('z-ai-web-dev-sdk', () => ({
  default: class {
    static async create() {
      throw new Error('ZAI not available in tests')
    }
  },
}))

// ---- mock 守卫与章后记忆（单独模块，统计调用）----
const extState = { guardCalls: 0, memoryCalls: 0 }

mock.module('@/lib/guard', () => ({
  runChapterGuardSafely: async () => {
    extState.guardCalls++
    return 0
  },
}))

mock.module('@/lib/chapter-memory', () => ({
  extractAndSaveChapterMemory: async () => {
    extState.memoryCalls++
    return {
      ok: true,
      tokensUsed: 100,
      summarySaved: true,
      timelineSaved: 1,
      foreshadowPlanted: 1,
      foreshadowResolved: 0,
    }
  },
}))

const { runAutoSerialChapter } = await import('../src/lib/auto-serial-runner')

function longReply(title: string, chars: number) {
  return `${title}\n\n${'正'.repeat(chars)}`
}

describe('runAutoSerialChapter', () => {
  beforeEach(() => {
    resetDbState()
    resetAiState()
    chapterCreateData.length = 0
    extState.guardCalls = 0
    extState.memoryCalls = 0
  })

  test('成功生成：解析标题与正文、守卫与记忆沉淀被调用、Token 正常扣除', async () => {
    aiState.queue = [longReply('第6章 试炼开始', 2000)]

    const result = await runAutoSerialChapter('task-1')

    expect(result.ok).toBe(true)
    expect(result.chapter?.title).toBe('第6章 试炼开始')
    expect(result.chapter?.words).toBe(2000)
    expect(dbState.createdChapters[0].status).toBe('draft')
    expect(dbState.createdChapters[0].volumeId).toBe('vol-1')
    expect(extState.guardCalls).toBe(1)
    expect(extState.memoryCalls).toBe(1)
    // Token 扣除：1 次，含记忆提取消耗
    expect(dbState.tokenDeductions.length).toBe(1)
    expect(dbState.tokenDeductions[0].data.tokens.decrement).toBeGreaterThan(100)
    // 任务状态回到 idle 且计数 +1
    const lastUpdate = dbState.autoSerialUpdates[dbState.autoSerialUpdates.length - 1]
    expect(lastUpdate.data.status).toBe('idle')
    expect(lastUpdate.data.totalGenerated).toBe(1)
    // 上下文装配注入了大纲资料
    expect(aiState.calls[0].userLen).toBeGreaterThan(0)
  })

  test('字数不足自动重试 1 次，采用字数更多的稿件', async () => {
    aiState.queue = [
      `第6章 短稿\n\n${'短'.repeat(50)}`, // 第一次：远低于 1600 字下限
      longReply('第6章 重试稿', 2000), // 重试：达标
    ]

    const result = await runAutoSerialChapter('task-1')

    expect(result.ok).toBe(true)
    expect(result.chapter?.title).toBe('第6章 重试稿')
    expect(result.chapter?.words).toBe(2000)
    // 调用次数 = 生成×2 + 重试稿的去AI味×1（短稿不足 100 字跳过精修）
    expect(aiState.calls.length).toBe(3)
  })

  test('AI 全部失败：任务标记 error 并返回失败', async () => {
    aiState.failAll = true

    const result = await runAutoSerialChapter('task-1')

    expect(result.ok).toBe(false)
    const lastUpdate = dbState.autoSerialUpdates[dbState.autoSerialUpdates.length - 1]
    expect(lastUpdate.data.status).toBe('error')
    expect(dbState.createdChapters.length).toBe(0)
    expect(extState.guardCalls).toBe(0)
  })

  test('重复触发同一任务被拒绝', async () => {
    aiState.queue = [longReply('第6章 并发稿', 2000)]
    const [first, second] = await Promise.all([
      runAutoSerialChapter('task-1'),
      runAutoSerialChapter('task-1'),
    ])
    const okCount = [first, second].filter((r) => r.ok).length
    expect(okCount).toBe(1)
  })
})
