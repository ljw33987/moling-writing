import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'

const CHAPTER_HEADER_RE =
  /^(第[零一二三四五六七八九十百千万两0-9]+[章回节卷][^\n]{0,40}|Chapter\s+\d+[^\n]{0,40})$/gim

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  const body = await req.json()
  const { novelId, volumeTitle = 'TXT 导入卷', rawText } = body
  if (!novelId || !rawText?.trim()) {
    return NextResponse.json({ error: '请提供作品 ID 与 TXT 文本内容' }, { status: 400 })
  }

  const novel = await db.novel.findFirst({
    where: { id: novelId, userId: session.user.id },
  })
  if (!novel) {
    return NextResponse.json({ error: '作品不存在或无权操作' }, { status: 404 })
  }

  const normalized = rawText.replace(/\r\n?/g, '\n')
  const matches = [...normalized.matchAll(CHAPTER_HEADER_RE)]

  const parsedChapters: Array<{ title: string; content: string; words: number }> = []
  if (matches.length === 0) {
    const content = normalized.trim()
    parsedChapters.push({
      title: '第一章 导入正文',
      content,
      words: content.replace(/\s/g, '').length,
    })
  } else {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]
      const start = (m.index ?? 0) + m[0].length
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? normalized.length) : normalized.length
      const title = m[0].trim()
      const content = normalized.slice(start, end).trim()
      parsedChapters.push({
        title,
        content,
        words: content.replace(/\s/g, '').length,
      })
    }
  }

  const maxVol = await db.volume.aggregate({
    where: { novelId },
    _max: { sortOrder: true },
  })
  const volume = await db.volume.create({
    data: {
      title: volumeTitle.trim() || 'TXT 导入卷',
      novelId,
      sortOrder: (maxVol._max.sortOrder || 0) + 1,
    },
  })

  for (let i = 0; i < parsedChapters.length; i++) {
    const c = parsedChapters[i]
    await db.chapter.create({
      data: {
        title: c.title,
        content: c.content,
        words: c.words,
        sortOrder: i + 1,
        volumeId: volume.id,
        novelId,
      },
    })
  }

  const agg = await db.chapter.aggregate({
    where: { novelId },
    _sum: { words: true },
  })
  await db.novel.update({
    where: { id: novelId },
    data: { totalWords: agg._sum.words || 0 },
  })

  return NextResponse.json({
    ok: true,
    volumeId: volume.id,
    importedCount: parsedChapters.length,
    totalWords: agg._sum.words || 0,
  })
}
