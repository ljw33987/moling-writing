import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { getOwnedNovel } from '@/lib/ownership'

const VALID_STATUSES = ['planted', 'advanced', 'resolved', 'abandoned']

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const novelId = new URL(req.url).searchParams.get('novelId')
  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })
  if (!await getOwnedNovel(session.user.id, novelId)) {
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }

  const foreshadowings = await db.foreshadowing.findMany({
    where: { novelId },
    orderBy: [{ hintWeight: 'desc' }, { updatedAt: 'desc' }],
  })
  return NextResponse.json({ foreshadowings })
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { novelId, title, description, plantedChapter, hintWeight, status } = body
  if (!novelId || !title?.trim()) {
    return NextResponse.json({ error: '伏笔标题不能为空' }, { status: 400 })
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: '无效的状态' }, { status: 400 })
  }
  if (!await getOwnedNovel(session.user.id, novelId)) {
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }

  const foreshadowing = await db.foreshadowing.create({
    data: {
      novelId,
      title: title.trim().slice(0, 60),
      description: description?.trim()?.slice(0, 2000) || null,
      status: status || 'planted',
      plantedChapter:
        typeof plantedChapter === 'number' && plantedChapter >= 1 ? plantedChapter : null,
      hintWeight:
        typeof hintWeight === 'number' && hintWeight >= 1 && hintWeight <= 3 ? hintWeight : 2,
    },
  })

  return NextResponse.json({ foreshadowing })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { id, title, description, status, plantedChapter, resolvedChapter, hintWeight, progressNote } = body
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: '无效的状态' }, { status: 400 })
  }

  const existing = await db.foreshadowing.findUnique({
    where: { id },
    select: { novelId: true, status: true, progressNotes: true },
  })
  if (!existing || !await getOwnedNovel(session.user.id, existing.novelId)) {
    return NextResponse.json({ error: '未找到伏笔' }, { status: 404 })
  }

  const data: any = {}
  if (title !== undefined) data.title = String(title).trim().slice(0, 60)
  if (description !== undefined) data.description = description ? String(description).slice(0, 2000) : null
  if (hintWeight !== undefined) {
    if (typeof hintWeight !== 'number' || hintWeight < 1 || hintWeight > 3) {
      return NextResponse.json({ error: '权重取值 1-3' }, { status: 400 })
    }
    data.hintWeight = hintWeight
  }
  if (plantedChapter !== undefined) {
    data.plantedChapter = typeof plantedChapter === 'number' && plantedChapter >= 1 ? plantedChapter : null
  }
  if (resolvedChapter !== undefined) {
    data.resolvedChapter = typeof resolvedChapter === 'number' && resolvedChapter >= 1 ? resolvedChapter : null
  }

  // 状态流转：resolved 时自动补回收章号；planted 时清空回收章号
  if (status !== undefined) {
    data.status = status
    if (status === 'resolved' && resolvedChapter === undefined && !existing.progressNotes?.includes('"回收')) {
      // 未显式指定回收章号时保持为空，由作者自行补充
    }
    if (status !== 'resolved') data.resolvedChapter = null
  }

  // 推进记录追加（progressNote: { chapterNum?, note }）
  if (progressNote?.note?.trim()) {
    let notes: Array<{ chapterNum: number; note: string }> = []
    try {
      const parsed = existing.progressNotes ? JSON.parse(existing.progressNotes) : []
      if (Array.isArray(parsed)) notes = parsed
    } catch {}
    notes.push({
      chapterNum: typeof progressNote.chapterNum === 'number' ? progressNote.chapterNum : 0,
      note: String(progressNote.note).slice(0, 200),
    })
    data.progressNotes = JSON.stringify(notes.slice(-20))
    // 有推进记录时自动流转为 advanced（resolved/abandoned 状态除外）
    if (!status && existing.status === 'planted') data.status = 'advanced'
  }

  const foreshadowing = await db.foreshadowing.update({ where: { id }, data })
  return NextResponse.json({ foreshadowing })
}

export async function DELETE(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  const existing = await db.foreshadowing.findUnique({ where: { id }, select: { novelId: true } })
  if (!existing || !await getOwnedNovel(session.user.id, existing.novelId)) {
    return NextResponse.json({ error: '未找到伏笔' }, { status: 404 })
  }

  await db.foreshadowing.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
