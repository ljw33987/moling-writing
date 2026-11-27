import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { getOwnedNovel } from '@/lib/ownership'

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const url = new URL(req.url)
  const novelId = url.searchParams.get('novelId')
  const type = url.searchParams.get('type') || 'character'

  const where: any = { userId: user.id }
  if (novelId) {
    if (!await getOwnedNovel(user.id, novelId)) {
      return NextResponse.json({ error: '未找到作品' }, { status: 404 })
    }
    where.OR = [{ novelId }, { novelId: null }]
  }

  let data: any[]
  if (type === 'character') {
    data = await db.character.findMany({ where, orderBy: { updatedAt: 'desc' } })
  } else if (type === 'worldview') {
    data = await db.worldview.findMany({ where, orderBy: { updatedAt: 'desc' } })
  } else {
    data = await db.item.findMany({ where, orderBy: { updatedAt: 'desc' } })
  }
  return NextResponse.json({ items: data })
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const body = await req.json()
  const { type = 'character', novelId, subtype, ...fields } = body
  if (!['character', 'worldview', 'item'].includes(type)) {
    return NextResponse.json({ error: '无效的设定类型' }, { status: 400 })
  }

  if (novelId && !await getOwnedNovel(user.id, novelId)) {
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }

  const data: any = { userId: user.id, novelId: novelId || null }

  if (type === 'character') {
    Object.assign(data, {
      name: fields.name || '新角色',
      avatar: fields.avatar || null,
      appearance: fields.appearance || null,
      personality: fields.personality || null,
      background: fields.background || null,
      abilities: fields.abilities || null,
      relations: fields.relations || null,
    })
    const item = await db.character.create({ data })
    return NextResponse.json({ item })
  } else if (type === 'worldview') {
    Object.assign(data, {
      name: fields.name || '新设定',
      type: subtype || fields.worldviewType || 'geography',
      description: fields.description || null,
    })
    const item = await db.worldview.create({ data })
    return NextResponse.json({ item })
  } else {
    Object.assign(data, {
      name: fields.name || '新道具',
      type: subtype || 'item',
      attributes: fields.attributes || null,
      effect: fields.effect || null,
    })
    const item = await db.item.create({ data })
    return NextResponse.json({ item })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { id, type = 'character', subtype, ...fields } = body
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  if (!['character', 'worldview', 'item'].includes(type)) {
    return NextResponse.json({ error: '无效的设定类型' }, { status: 400 })
  }
  const ownerWhere = { id, userId: session.user.id }
  const existing = type === 'character'
    ? await db.character.findFirst({ where: ownerWhere, select: { id: true } })
    : type === 'worldview'
      ? await db.worldview.findFirst({ where: ownerWhere, select: { id: true } })
      : await db.item.findFirst({ where: ownerWhere, select: { id: true } })
  if (!existing) return NextResponse.json({ error: '未找到设定' }, { status: 404 })
  if (fields.novelId && !await getOwnedNovel(session.user.id, fields.novelId)) {
    return NextResponse.json({ error: '未找到作品' }, { status: 404 })
  }

  const allowed: Record<string, string[]> = {
    character: ['name', 'avatar', 'appearance', 'personality', 'background', 'abilities', 'relations', 'novelId'],
    worldview: ['name', 'description', 'novelId'],
    item: ['name', 'attributes', 'effect', 'novelId'],
  }
  const data: any = {}
  for (const key of allowed[type] || []) {
    if (fields[key] !== undefined) data[key] = fields[key]
  }
  if (type !== 'character' && typeof subtype === 'string' && subtype.trim()) data.type = subtype.trim()

  let item: any
  if (type === 'character') item = await db.character.update({ where: { id }, data })
  else if (type === 'worldview') item = await db.worldview.update({ where: { id }, data })
  else item = await db.item.update({ where: { id }, data })

  return NextResponse.json({ item })
}

export async function DELETE(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const type = url.searchParams.get('type') || 'character'
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

  if (!['character', 'worldview', 'item'].includes(type)) {
    return NextResponse.json({ error: '无效的设定类型' }, { status: 400 })
  }
  const ownerWhere = { id, userId: session.user.id }
  const existing = type === 'character'
    ? await db.character.findFirst({ where: ownerWhere, select: { id: true } })
    : type === 'worldview'
      ? await db.worldview.findFirst({ where: ownerWhere, select: { id: true } })
      : await db.item.findFirst({ where: ownerWhere, select: { id: true } })
  if (!existing) return NextResponse.json({ error: '未找到设定' }, { status: 404 })

  if (type === 'character') await db.character.delete({ where: { id } })
  else if (type === 'worldview') await db.worldview.delete({ where: { id } })
  else await db.item.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
