import { PrismaClient } from '@prisma/client'
import ZAI from 'z-ai-web-dev-sdk'
import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dir, '../..')

// 本服务必须与主应用共用同一个 SQLite 库与同一份平台 AI 配置。
// 优先读取仓库根目录的 .env（进程从任意目录启动都能拿到 DATABASE_URL）。
if (!process.env.DATABASE_URL) {
  const envPath = resolve(repoRoot, '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      let value = m[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = value
    }
  }
}

// 配置 Prisma（未配置时回落到仓库内的 prisma/local.db，与主应用一致）
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'file:./local.db' } },
})

const SCAN_INTERVAL = 30 * 1000 // 30 秒扫描一次
const MAX_CONCURRENT = 1 // 同时只跑 1 个生成任务

let running = false

async function processTask(task: any) {
  console.log(`[AutoSerial] 处理任务 ${task.id}，小说 ${task.novelId}`)
  try {
    // 标记为运行中
    await db.autoSerial.update({
      where: { id: task.id },
      data: { status: 'running', lastRunAt: new Date() },
    })

    // 获取小说信息
    const novel = await db.novel.findUnique({
      where: { id: task.novelId },
      include: {
        volumes: {
          orderBy: { sortOrder: 'desc' },
          take: 1,
          include: {
            chapters: { orderBy: { sortOrder: 'desc' }, take: 1 },
          },
        },
        chapters: { orderBy: { sortOrder: 'desc' }, take: 5 },
      },
    })

    if (!novel) throw new Error('小说不存在')

    // 找最后一章
    const lastChapter = novel.chapters[0]
    const lastVolume = novel.volumes[0]
    if (!lastVolume) throw new Error('小说没有卷')

    // 计算下一章序号
    const totalChapters = await db.chapter.count({ where: { novelId: novel.id } })
    const chapterNum = totalChapters + 1

    // 组装上下文
    const recentChapters = novel.chapters
      .slice(0, 3)
      .reverse()
      .map((c: any) => `第${c.sortOrder + 1}章 ${c.title}：${c.content?.slice(-500) || ''}`)
      .join('\n---\n')

    const characters = await db.character.findMany({ where: { novelId: novel.id } })
    const charInfo = characters
      .map((c: any) => `${c.name}（${c.personality || '未知性格'}，${c.abilities || '无能力'}）`)
      .join('；')

    const prompt = `请为小说《${novel.title}》创作第${chapterNum}章。
类型：${novel.genre}
简介：${novel.synopsis || '（无）'}
大纲：${novel.outline || '（无）'}
${task.plotDirection ? `剧情走向提示：${task.plotDirection}` : ''}
核心角色：${charInfo || '（无设定）'}

最近章节末尾内容：
${recentChapters || '（这是第一章）'}

要求：
1. 章节标题要符合网文风格（如：第${chapterNum}章 危机降临）
2. 正文 ${task.targetWords} 字左右
3. 自然衔接前文，推进剧情
4. 保持人物性格一致
5. 直接输出：第一行是「第X章 标题」，第二行空行，然后是正文
`

    console.log(`[AutoSerial] 调用 AI 生成第 ${chapterNum} 章...`)

    // 调用 AI：优先使用后台配置的第三方接口（与主应用同一套模型），
    // 没有配置时才回落到内置 z-ai。
    const messages = [
      {
        role: 'system',
        content:
          '你是专业的网文写手，擅长节奏紧凑、画面感强的章节。根据用户提供的上下文自然续写下一章。\n' +
          '【人类自然口吻与去 AI 味铁律】\n' +
          '1. 像真人在写故事、像活人在说话：对话要有口语停顿、打断、反问、情绪潜台词，严禁角色像播音员一样长篇大论讲道理。\n' +
          '2. 用具体动作、眼神与生活细节推进情绪，严禁「这让他心中五味杂陈」「空气仿佛凝固」「命运的齿轮开始转动」这类空洞总结句。\n' +
          '3. 句式长短错落，多用短句与动词，严禁连续三句结构对称的排比。\n' +
          '4. 严禁使用高频 AI 套话：不禁、仿佛、然而、嘴角微微上扬、一抹、眼神微眯、深吸一口气、心中五味杂陈、宛如、不由自主、值得一提、在这一刻、悄然、骤然、陡然、蓦然。',
      },
      { role: 'user', content: prompt },
    ]

    let reply = ''
    const platform = await db.platformConfig.findFirst().catch(() => null)
    const baseUrl = (platform?.defaultAiBaseUrl || '').trim()
    const apiKey = (platform?.defaultAiApiKey || '').trim()
    const model = (platform?.defaultAiModel || '').trim()

    if (baseUrl && apiKey && model && !apiKey.startsWith('****')) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream: false }),
      })
      if (!res.ok) {
        throw new Error(`AI 接口 ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      const data: any = await res.json()
      reply = data?.choices?.[0]?.message?.content || ''
    } else {
      const zai = await ZAI.create()
      const completion: any = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      } as any)
      reply = completion?.choices?.[0]?.message?.content || ''
    }

    // 解析标题和正文
    let title = `第${chapterNum}章`
    let content = reply
    const firstLine = reply.split('\n')[0]?.trim()
    if (firstLine && firstLine.length < 50 && (firstLine.includes('第') || firstLine.includes('章'))) {
      title = firstLine.replace(/^#+\s*/, '')
      content = reply.split('\n').slice(1).join('\n').trim()
    }

    // 保存章节
    const newChapter = await db.chapter.create({
      data: {
        title,
        content,
        summary: `AI 自动连载生成（${new Date().toLocaleString('zh-CN')}）`,
        words: content.replace(/\s/g, '').length,
        status: 'final',
        sortOrder: (lastChapter?.sortOrder || 0) + 1,
        autoGen: true,
        volumeId: lastVolume.id,
        novelId: novel.id,
      },
    })

    // 更新小说总字数
    const agg = await db.chapter.aggregate({
      where: { novelId: novel.id },
      _sum: { words: true },
    })
    await db.novel.update({
      where: { id: novel.id },
      data: { totalWords: agg._sum.words || 0, updatedAt: new Date() },
    })

    // 扣 Token
    const tokensUsed = Math.ceil((prompt.length + reply.length) / 3)
    const owner = await db.user.findUnique({ where: { id: task.userId } })
    if (owner) {
      const newTokens = Math.max(0, owner.tokens - tokensUsed)
      const tokenDepleted = newTokens <= 0
      await db.user.update({
        where: { id: owner.id },
        data: { tokens: newTokens },
      })

      // 记录对话
      await db.chatMessage.create({
        data: {
          role: 'assistant',
          content: `【自动连载】生成第${chapterNum}章「${title}」，${newChapter.words}字`,
          preset: 'auto_serial',
          novelId: novel.id,
          chapterId: newChapter.id,
          tokensUsed,
          userId: owner.id,
        },
      })

      // 计算下次运行时间
      const nextRunAt = new Date(Date.now() + task.intervalMin * 60 * 1000)
      await db.autoSerial.update({
        where: { id: task.id },
        data: {
          status: tokenDepleted ? 'error' : 'idle',
          lastError: tokenDepleted ? 'Token 余额不足' : null,
          enabled: !tokenDepleted,
          totalGenerated: { increment: 1 },
          nextRunAt,
        },
      })

      console.log(
        `[AutoSerial] ✓ 小说《${novel.title}》第${chapterNum}章已生成（${newChapter.words}字），消耗 ${tokensUsed} Token，下次执行：${nextRunAt.toLocaleString('zh-CN')}`
      )
    }
  } catch (e: any) {
    console.error(`[AutoSerial] 任务 ${task.id} 失败:`, e.message)
    // 设置下次重试（5 分钟后）+ 标记错误
    const retryAt = new Date(Date.now() + 5 * 60 * 1000)
    await db.autoSerial.update({
      where: { id: task.id },
      data: {
        status: 'error',
        lastError: e.message?.slice(0, 500) || '未知错误',
        nextRunAt: retryAt,
      },
    })
  }
}

async function scanAndRun() {
  if (running) return
  running = true
  try {
    const now = new Date()
    const dueTasks = await db.autoSerial.findMany({
      where: {
        enabled: true,
        status: { in: ['idle', 'error'] },
        nextRunAt: { lte: now },
      },
      take: MAX_CONCURRENT,
    })

    if (dueTasks.length === 0) return

    console.log(`[AutoSerial] 发现 ${dueTasks.length} 个待执行任务`)
    for (const task of dueTasks) {
      await processTask(task)
    }
  } catch (e: any) {
    console.error('[AutoSerial] 扫描失败:', e.message)
  } finally {
    running = false
  }
}

console.log(`[AutoSerial] 服务启动，每 ${SCAN_INTERVAL / 1000} 秒扫描一次`)
setInterval(scanAndRun, SCAN_INTERVAL)

// 启动时立即扫描一次
setTimeout(scanAndRun, 3000)

// 保持进程
setInterval(() => {}, 1 << 30)
