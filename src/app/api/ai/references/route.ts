import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'

export interface AiReferenceOption {
  type: 'chapter' | 'outline' | 'character' | 'worldview' | 'item'
  id: string
  title: string
  subtitle?: string
}

// GET /api/ai/references?novelId=... - 获取当前小说可用于 @ 引用的文件与设定列表
export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const novelId = req.nextUrl.searchParams.get('novelId')
  if (!novelId) {
    return NextResponse.json({ error: '缺少 novelId' }, { status: 400 })
  }

  const novel = await db.novel.findFirst({
    where: { id: novelId, userId: session.user.id },
    select: {
      id: true,
      title: true,
      synopsis: true,
      outline: true,
      volumes: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          chapters: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, title: true, words: true },
          },
        },
      },
    },
  })

  if (!novel) {
    return NextResponse.json({ error: '作品不存在' }, { status: 404 })
  }

  const [characters, worldviews, items] = await Promise.all([
    db.character.findMany({
      where: { userId: session.user.id, OR: [{ novelId }, { novelId: null }] },
      select: { id: true, name: true, personality: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.worldview.findMany({
      where: { userId: session.user.id, OR: [{ novelId }, { novelId: null }] },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.item.findMany({
      where: { userId: session.user.id, OR: [{ novelId }, { novelId: null }] },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const references: AiReferenceOption[] = [
    {
      type: 'outline',
      id: 'novel_outline',
      title: '全书大纲与简介',
      subtitle: novel.outline ? '已填写大纲' : novel.synopsis ? '仅简介' : '暂未填写',
    },
  ]

  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      references.push({
        type: 'chapter',
        id: ch.id,
        title: ch.title,
        subtitle: `${vol.title} · ${ch.words} 字`,
      })
    }
  }

  for (const c of characters) {
    references.push({
      type: 'character',
      id: c.id,
      title: c.name,
      subtitle: c.personality ? `角色 · ${c.personality.slice(0, 20)}` : '角色设定',
    })
  }

  for (const w of worldviews) {
    references.push({
      type: 'worldview',
      id: w.id,
      title: w.name,
      subtitle: `世界观 · ${w.type}`,
    })
  }

  for (const it of items) {
    references.push({
      type: 'item',
      id: it.id,
      title: it.name,
      subtitle: `道具/功法 · ${it.type}`,
    })
  }

  return NextResponse.json({ references })
}
