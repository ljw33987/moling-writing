import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'

const HEADER = /^(?:第[零一二三四五六七八九十百千万两0-9]+([章回节卷])[^\n]{0,40}|Chapter[ \t]+\d+[^\n]{0,40})$/gim

type ImportedChapter = { title: string; content: string; words: number; sortOrder: number }
type ImportedVolume = { title: string; chapters: ImportedChapter[] }

function splitManuscript(text: string, firstVolumeTitle: string) {
  const volumes: ImportedVolume[] = []
  let volume: ImportedVolume = { title: firstVolumeTitle, chapters: [] }
  let chapterTitle = ''
  let start = 0

  function addChapter(end: number) {
    const content = text.slice(start, end).trim()
    if (!chapterTitle && !content) return
    volume.chapters.push({
      title: chapterTitle || (end === text.length ? '第一章 导入正文' : '序章'),
      content,
      words: content.replace(/\s/g, '').length,
      sortOrder: volume.chapters.length,
    })
  }

  for (const match of text.matchAll(HEADER)) {
    addChapter(match.index)
    start = match.index + match[0].length
    if (match[1] === '卷') {
      if (volume.chapters.length) volumes.push(volume)
      volume = { title: match[0].trim(), chapters: [] }
      chapterTitle = ''
    } else {
      chapterTitle = match[0].trim()
    }
  }
  addChapter(text.length)
  if (volume.chapters.length) volumes.push(volume)
  return volumes
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const body = await req.json().catch(() => null)
  const { novelId, volumeTitle, rawText, content, title, folderId } = body ?? {}
  const append = novelId !== undefined
  const input = append ? rawText : content
  if ((append && (typeof novelId !== 'string' || !novelId.trim())) ||
    typeof input !== 'string' || !input.trim()) {
    return NextResponse.json({ error: '请提供有效的作品信息与 TXT 文本内容' }, { status: 400 })
  }

  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  const importVolumeTitle = typeof volumeTitle === 'string' && volumeTitle.trim()
    ? volumeTitle.trim()
    : 'TXT 导入卷'
  const parsedVolumes = splitManuscript(text, append ? importVolumeTitle : '第一卷')
  const chapters = parsedVolumes.flatMap((volume) => volume.chapters)
  if (!chapters.length) return NextResponse.json({ error: 'TXT 中没有可导入的章节' }, { status: 400 })

  if (append) {
    const result = await db.$transaction(async (tx) => {
      // 在分配分卷顺序前锁住作品行，串行处理同一作品的追加导入。
      const locked = await tx.novel.updateMany({
        where: { id: novelId, userId: user.id, deleted: false },
        data: { updatedAt: new Date() },
      })
      if (!locked.count) return null
      const maxVolume = await tx.volume.aggregate({ where: { novelId }, _max: { sortOrder: true } })
      const volume = await tx.volume.create({
        data: { novelId, title: importVolumeTitle, sortOrder: (maxVolume._max.sortOrder ?? -1) + 1 },
      })
      await tx.chapter.createMany({
        data: chapters.map((chapter, index) => ({ ...chapter, novelId, volumeId: volume.id, sortOrder: index })),
      })
      const totals = await tx.chapter.aggregate({ where: { novelId }, _sum: { words: true } })
      const totalWords = totals._sum.words ?? 0
      await tx.novel.update({ where: { id: novelId }, data: { totalWords } })
      return { ok: true, volumeId: volume.id, importedCount: chapters.length, totalWords }
    })
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: '作品不存在或无权操作' }, { status: 404 })
  }

  const destinationFolder = typeof folderId === 'string' && folderId.trim() ? folderId : null
  const result = await db.$transaction(async (tx) => {
    if (destinationFolder && !await tx.folder.findFirst({
      where: { id: destinationFolder, userId: user.id },
      select: { id: true },
    })) return null

    const novel = await tx.novel.create({
      data: {
        userId: user.id,
        folderId: destinationFolder,
        author: user.penName || user.name || '匿名',
        title: (typeof title === 'string' ? title.trim() : '') ||
          text.split('\n', 1)[0].trim().slice(0, 40) || 'TXT 导入作品',
        totalWords: chapters.reduce((total, chapter) => total + chapter.words, 0),
      },
    })
    for (const [sortOrder, imported] of parsedVolumes.entries()) {
      const volume = await tx.volume.create({
        data: { novelId: novel.id, title: imported.title, sortOrder },
      })
      await tx.chapter.createMany({
        data: imported.chapters.map((chapter) => ({ ...chapter, novelId: novel.id, volumeId: volume.id })),
      })
    }
    return novel
  })
  return result
    ? NextResponse.json({ novel: result, importedCount: chapters.length })
    : NextResponse.json({ error: '未找到目标文件夹' }, { status: 404 })
}
