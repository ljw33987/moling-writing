import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { getOwnedChapter, getOwnedNovel, getOwnedVolume } from '@/lib/ownership'

async function refreshNovelWordCount(novelId: string) {
  const totals = await db.chapter.aggregate({ where: { novelId }, _sum: { words: true } })
  await db.novel.update({ where: { id: novelId }, data: { totalWords: totals._sum.words || 0 } })
}

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const url = new URL(req.url)
  const novelId = url.searchParams.get('novelId')
  const id = url.searchParams.get('id')

  if (id) {
    const owned = await getOwnedChapter(session.user.id, id)
    if (!owned) return NextResponse.json({ error: '未找到' }, { status: 404 })
    const chapter = await db.chapter.findUnique({ where: { id } })
    if (!chapter) return NextResponse.json({ error: '未找到' }, { status: 404 })
    return NextResponse.json({ chapter })
  }

  if (!novelId) return NextResponse.json({ error: '需要 novelId' }, { status: 400 })
  if (!await getOwnedNovel(session.user.id, novelId)) {
    return NextResponse.json({ error: '未找到' }, { status: 404 })
  }
  const chapters = await db.chapter.findMany({
    where: { novelId },
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json({ chapters })
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { type = 'chapter', title, volumeId, novelId, isOutline = false } = body

  if (!title?.trim()) return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
  if (!novelId || !await getOwnedNovel(session.user.id, novelId)) {
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }

  if (type === 'volume') {
    const maxOrder = await db.volume.aggregate({
      where: { novelId },
      _max: { sortOrder: true },
    })
    const volume = await db.volume.create({
      data: {
        title: title.trim(),
        novelId,
        isOutline,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    })
    return NextResponse.json({ volume })
  }

  if (!volumeId) return NextResponse.json({ error: '需要 volumeId' }, { status: 400 })
  const ownedVolume = await getOwnedVolume(session.user.id, volumeId)
  if (!ownedVolume || ownedVolume.novelId !== novelId) {
    return NextResponse.json({ error: '未找到分卷' }, { status: 404 })
  }
  const maxOrder = await db.chapter.aggregate({
    where: { volumeId },
    _max: { sortOrder: true },
  })
  const chapter = await db.chapter.create({
    data: {
      title: title.trim(),
      volumeId,
      novelId,
      sortOrder: (maxOrder._max.sortOrder || 0) + 1,
    },
  })
  return NextResponse.json({ chapter })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { action, id, content, title, status, sortOrder, summary, volumeId, chapterIds, novelId, volumeIds } = body

  if (action === 'reorder') {
    if (!volumeId || !Array.isArray(chapterIds)) {
      return NextResponse.json({ error: '需要 volumeId 和 chapterIds' }, { status: 400 })
    }
    const targetVolume = await getOwnedVolume(session.user.id, volumeId)
    if (!targetVolume) {
      return NextResponse.json({ error: '目标分卷无效' }, { status: 400 })
    }
    await db.$transaction(
      chapterIds.map((chId: string, idx: number) =>
        db.chapter.updateMany({
          where: { id: chId, novelId: targetVolume.novelId },
          data: { volumeId, sortOrder: idx },
        })
      )
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'reorderVolumes') {
    if (!novelId || !Array.isArray(volumeIds)) {
      return NextResponse.json({ error: '需要 novelId 和 volumeIds' }, { status: 400 })
    }
    if (!await getOwnedNovel(session.user.id, novelId)) {
      return NextResponse.json({ error: '未找到作品' }, { status: 404 })
    }
    await db.$transaction(
      volumeIds.map((vId: string, idx: number) =>
        db.volume.updateMany({
          where: { id: vId, novelId },
          data: { sortOrder: idx },
        })
      )
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'batchMove') {
    if (!volumeId || !Array.isArray(chapterIds) || chapterIds.length === 0) {
      return NextResponse.json({ error: '需要 volumeId 和 chapterIds' }, { status: 400 })
    }
    const targetVolume = await getOwnedVolume(session.user.id, volumeId)
    if (!targetVolume) {
      return NextResponse.json({ error: '目标分卷无效' }, { status: 400 })
    }
    const maxOrder = await db.chapter.aggregate({
      where: { volumeId },
      _max: { sortOrder: true },
    })
    let nextOrder = (maxOrder._max.sortOrder ?? -1) + 1
    await db.$transaction(
      chapterIds.map((chId: string) =>
        db.chapter.updateMany({
          where: { id: chId, novelId: targetVolume.novelId },
          data: { volumeId, sortOrder: nextOrder++ },
        })
      )
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'batchDelete') {
    const chIds: string[] = Array.isArray(chapterIds) ? chapterIds : []
    const volIds: string[] = Array.isArray(volumeIds) ? volumeIds : []
    if (chIds.length === 0 && volIds.length === 0) {
      return NextResponse.json({ error: '请选择要删除的章节或分卷' }, { status: 400 })
    }

    const ownedChapters = chIds.length
      ? await db.chapter.findMany({
          where: { id: { in: chIds }, novel: { userId: session.user.id } },
          select: { id: true, novelId: true },
        })
      : []
    const ownedVolumes = volIds.length
      ? await db.volume.findMany({
          where: { id: { in: volIds }, novel: { userId: session.user.id } },
          select: { id: true, novelId: true, chapters: { select: { id: true } } },
        })
      : []

    const allDeletedChapterIds = Array.from(
      new Set([
        ...ownedChapters.map((c) => c.id),
        ...ownedVolumes.flatMap((v) => v.chapters.map((c) => c.id)),
      ])
    )
    const affectedNovelIds = Array.from(
      new Set([...ownedChapters.map((c) => c.novelId), ...ownedVolumes.map((v) => v.novelId)])
    )

    if (allDeletedChapterIds.length > 0) {
      await (db as any).timelineEvent.deleteMany({ where: { chapterId: { in: allDeletedChapterIds } } }).catch(() => {})
      await (db as any).consistencyIssue.deleteMany({ where: { chapterId: { in: allDeletedChapterIds } } }).catch(() => {})
      await db.chapter.deleteMany({ where: { id: { in: allDeletedChapterIds } } })
    }
    if (ownedVolumes.length > 0) {
      await db.volume.deleteMany({ where: { id: { in: ownedVolumes.map((v) => v.id) } } })
    }
    for (const nId of affectedNovelIds) {
      await refreshNovelWordCount(nId)
    }
    return NextResponse.json({ ok: true, deletedChapters: allDeletedChapterIds.length, deletedVolumes: ownedVolumes.length })
  }

  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  // 先取出旧章节，用于后续计算字数增量
  const oldChapter = await db.chapter.findUnique({ where: { id } })
  if (!oldChapter) return NextResponse.json({ error: '未找到章节' }, { status: 404 })
  const ownedChapter = await getOwnedChapter(session.user.id, id)
  if (!ownedChapter) return NextResponse.json({ error: '未找到章节' }, { status: 404 })

  const data: any = {}
  let newWords: number | null = null
  if (content !== undefined) {
    data.content = content
    newWords = content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length
    data.words = newWords
  }
  if (title !== undefined) data.title = title
  if (status !== undefined) data.status = status
  if (sortOrder !== undefined) data.sortOrder = sortOrder
  if (summary !== undefined) data.summary = summary
  if (volumeId !== undefined) {
    const targetVolume = await getOwnedVolume(session.user.id, volumeId)
    if (!targetVolume || targetVolume.novelId !== oldChapter.novelId) {
      return NextResponse.json({ error: '目标分卷无效' }, { status: 400 })
    }
    data.volumeId = volumeId
  }

  const chapter = await db.chapter.update({ where: { id }, data })

  if (newWords !== null && chapter.novelId) {
    const agg = await db.chapter.aggregate({
      where: { novelId: chapter.novelId },
      _sum: { words: true },
    })
    await db.novel.update({
      where: { id: chapter.novelId },
      data: { totalWords: agg._sum.words || 0 },
    })

    // 计算今日增量：新字数 - 旧字数（用 update 前的 oldChapter）
    const delta = Math.max(0, newWords - (oldChapter.words || 0))
    const today = new Date().toISOString().slice(0, 10)
    const user = await db.user.findFirst({ where: { novels: { some: { id: chapter.novelId } } } })
    if (user && delta > 0) {
      const existing = await db.dailyStat.findUnique({
        where: { userId_date: { userId: user.id, date: today } },
      })
      if (existing) {
        await db.dailyStat.update({
          where: { id: existing.id },
          data: { words: existing.words + delta },
        })
      } else {
        await db.dailyStat.create({
          data: { userId: user.id, date: today, words: delta },
        })
      }
    }
  }

  return NextResponse.json({ chapter })
}

export async function DELETE(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const type = url.searchParams.get('type')
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  if (type === 'volume') {
    const volume = await getOwnedVolume(session.user.id, id)
    if (!volume) return NextResponse.json({ error: '未找到分卷' }, { status: 404 })
    const volChapters = await db.chapter.findMany({ where: { volumeId: id }, select: { id: true } })
    const chIds = volChapters.map((c) => c.id)
    if (chIds.length > 0) {
      await (db as any).timelineEvent.deleteMany({ where: { chapterId: { in: chIds } } }).catch(() => {})
      await (db as any).consistencyIssue.deleteMany({ where: { chapterId: { in: chIds } } }).catch(() => {})
    }
    await db.volume.delete({ where: { id } })
    await refreshNovelWordCount(volume.novelId)
  } else {
    const chapter = await getOwnedChapter(session.user.id, id)
    if (!chapter) return NextResponse.json({ error: '未找到章节' }, { status: 404 })
    await (db as any).timelineEvent.deleteMany({ where: { chapterId: id } }).catch(() => {})
    await (db as any).consistencyIssue.deleteMany({ where: { chapterId: id } }).catch(() => {})
    await db.chapter.delete({ where: { id } })
    await refreshNovelWordCount(chapter.novelId)
  }
  return NextResponse.json({ ok: true })
}
