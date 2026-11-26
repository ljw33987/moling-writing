import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { isAutoSerialRunning, runAutoSerialChapter } from '@/lib/auto-serial-runner'

// GET /api/auto-serial?novelId=xxx - 获取小说的自动连载任务
export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const url = new URL(req.url)
  const novelId = url.searchParams.get('novelId')
  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })

  // 确认小说归属
  const novel = await db.novel.findUnique({ where: { id: novelId } })
  if (!novel || novel.userId !== session.user.id) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }

  let task = await db.autoSerial.findFirst({ where: { novelId } })
  if (!task) {
    // 默认创建一个未启用的任务
    task = await db.autoSerial.create({
      data: {
        novelId,
        userId: session.user.id,
        enabled: false,
        intervalMin: 60,
        targetWords: 2000,
        status: 'idle',
      },
    })
  }

  // 若服务热重载导致状态残留为 running 但实际未在运行，自动恢复为 idle
  if (task.status === 'running' && !isAutoSerialRunning(task.id)) {
    task = await db.autoSerial.update({
      where: { id: task.id },
      data: { status: task.enabled ? 'idle' : 'paused' },
    })
  }

  // 若已开启自动连载且到达计划执行时间，自动在后台触发下一章生成
  if (
    task.enabled &&
    task.status === 'idle' &&
    task.nextRunAt &&
    new Date(task.nextRunAt) <= new Date() &&
    !isAutoSerialRunning(task.id)
  ) {
    void runAutoSerialChapter(task.id)
  }

  const extra = await db.$queryRaw<Array<{ startChapterNum: number | null; targetVolumeId: string | null }>>`
    SELECT startChapterNum, targetVolumeId FROM AutoSerial WHERE id = ${task.id} LIMIT 1
  `.catch(() => [])

  return NextResponse.json({
    task: {
      ...task,
      startChapterNum: (task as any).startChapterNum ?? extra[0]?.startChapterNum ?? null,
      targetVolumeId: (task as any).targetVolumeId ?? extra[0]?.targetVolumeId ?? null,
    },
  })
}

// POST - 创建/更新任务
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { novelId, enabled, intervalMin, targetWords, plotDirection, startChapterNum, targetVolumeId } = body

  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })
  const novel = await db.novel.findUnique({ where: { id: novelId } })
  if (!novel || novel.userId !== session.user.id) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }

  let task = await db.autoSerial.findFirst({ where: { novelId } })
  const baseData: any = {}
  if (enabled !== undefined) {
    baseData.enabled = enabled
    baseData.status = enabled ? 'idle' : 'paused'
    if (enabled) {
      baseData.nextRunAt = new Date() // 启用时立即触发一次
    }
  }
  if (intervalMin !== undefined) baseData.intervalMin = Math.max(1, Number(intervalMin) || 1)
  if (targetWords !== undefined) baseData.targetWords = Math.max(500, targetWords)
  if (plotDirection !== undefined) baseData.plotDirection = plotDirection

  const hasStartChapter = startChapterNum !== undefined
  const parsedStartChapter =
    startChapterNum && Number(startChapterNum) >= 1 ? Math.floor(Number(startChapterNum)) : null
  const hasTargetVolume = targetVolumeId !== undefined
  const parsedTargetVolume = targetVolumeId || null

  try {
    const fullData = {
      ...baseData,
      ...(hasStartChapter ? { startChapterNum: parsedStartChapter } : {}),
      ...(hasTargetVolume ? { targetVolumeId: parsedTargetVolume } : {}),
    }
    if (task) {
      task = await db.autoSerial.update({ where: { id: task.id }, data: fullData })
    } else {
      task = await db.autoSerial.create({
        data: {
          novelId,
          userId: session.user.id,
          enabled: enabled ?? false,
          intervalMin: intervalMin ?? 60,
          targetWords: targetWords ?? 2000,
          plotDirection: plotDirection ?? null,
          status: 'idle',
          nextRunAt: enabled ? new Date() : null,
          ...fullData,
        },
      })
    }
  } catch {
    // 兼容未重启 dev server 时旧版 Prisma Client 尚无新字段的情况
    if (task) {
      task = await db.autoSerial.update({ where: { id: task.id }, data: baseData })
    } else {
      task = await db.autoSerial.create({
        data: {
          novelId,
          userId: session.user.id,
          enabled: enabled ?? false,
          intervalMin: intervalMin ?? 60,
          targetWords: targetWords ?? 2000,
          plotDirection: plotDirection ?? null,
          status: 'idle',
          nextRunAt: enabled ? new Date() : null,
          ...baseData,
        },
      })
    }
    if (hasStartChapter) {
      await db.$executeRaw`UPDATE AutoSerial SET startChapterNum = ${parsedStartChapter} WHERE id = ${task.id}`
    }
    if (hasTargetVolume) {
      await db.$executeRaw`UPDATE AutoSerial SET targetVolumeId = ${parsedTargetVolume} WHERE id = ${task.id}`
    }
  }

  // 若开启自动连载，立即在后台触发一次生成
  if (enabled === true && !isAutoSerialRunning(task.id)) {
    void runAutoSerialChapter(task.id)
  }

  return NextResponse.json({
    task: {
      ...task,
      ...(hasStartChapter ? { startChapterNum: parsedStartChapter } : {}),
      ...(hasTargetVolume ? { targetVolumeId: parsedTargetVolume } : {}),
    },
  })
}

// 立即触发一次生成（手动调用）
// POST /api/auto-serial/run?novelId=xxx
export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const novelId = url.searchParams.get('novelId')

  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })

  const task = await db.autoSerial.findFirst({ where: { novelId } })
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  if (task.userId !== session.user.id) return NextResponse.json({ error: '无权操作' }, { status: 403 })

  if (action === 'run-now') {
    const result = await runAutoSerialChapter(task.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error || '生成失败' }, { status: 500 })
    }
    const updatedTask = await db.autoSerial.findUnique({ where: { id: task.id } })
    return NextResponse.json({
      ok: true,
      chapter: result.chapter,
      task: updatedTask,
      message: `已生成新章节「${result.chapter?.title}」`,
    })
  }

  if (action === 'pause') {
    const updated = await db.autoSerial.update({
      where: { id: task.id },
      data: { enabled: false, status: 'paused' },
    })
    return NextResponse.json({ task: updated })
  }

  if (action === 'resume') {
    const updated = await db.autoSerial.update({
      where: { id: task.id },
      data: { enabled: true, status: 'idle', nextRunAt: new Date() },
    })
    return NextResponse.json({ task: updated })
  }

  return NextResponse.json({ error: '未知 action' }, { status: 400 })
}
