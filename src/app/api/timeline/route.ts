import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const novelId = new URL(req.url).searchParams.get('novelId')
  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })

  const events = await (db as any).timelineEvent.findMany({
    where: { novelId },
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json({ events })
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { novelId, chapterId, timeLabel, title, description } = body
  if (!novelId || !timeLabel?.trim() || !title?.trim()) {
    return NextResponse.json({ error: '时间锚点和事件标题不能为空' }, { status: 400 })
  }

  const agg = await (db as any).timelineEvent.aggregate({
    where: { novelId },
    _max: { sortOrder: true },
  })

  const event = await (db as any).timelineEvent.create({
    data: {
      novelId,
      chapterId: chapterId || null,
      timeLabel: timeLabel.trim(),
      title: title.trim(),
      description: description?.trim() || null,
      sortOrder: (agg._max.sortOrder || 0) + 1,
    },
  })

  return NextResponse.json({ event })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { id, timeLabel, title, description, sortOrder } = body
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  const data: any = {}
  if (timeLabel !== undefined) data.timeLabel = timeLabel
  if (title !== undefined) data.title = title
  if (description !== undefined) data.description = description
  if (sortOrder !== undefined) data.sortOrder = sortOrder

  const event = await (db as any).timelineEvent.update({ where: { id }, data })
  return NextResponse.json({ event })
}

export async function DELETE(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  await (db as any).timelineEvent.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
