import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { PROMPT_CATEGORIES } from '@/lib/official-prompts'
import { sortPromptTemplates, syncOfficialPrompts } from '@/lib/prompt-sync'

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  await syncOfficialPrompts()

  const url = new URL(req.url)
  const category = url.searchParams.get('category') || ''
  const q = (url.searchParams.get('q') || '').trim()

  const where: any = {}
  if (category && category !== '全部') where.category = category
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { authorName: { contains: q } },
    ]
  }

  const items = await (db as any).promptTemplate.findMany({
    where,
    orderBy: [{ isOfficial: 'desc' }, { useCount: 'desc' }, { createdAt: 'desc' }],
  })

  // 官方模板按内置顺序稳定展示，用户模板按热度排在后面
  return NextResponse.json({ items: sortPromptTemplates(items) })
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  const body = await req.json()
  const { title, description, promptText } = body
  const category = PROMPT_CATEGORIES.includes(body.category) ? body.category : '大纲模板'
  if (!title?.trim() || !description?.trim() || !promptText?.trim()) {
    return NextResponse.json({ error: '标题、简介和提示词内容不能为空' }, { status: 400 })
  }

  const item = await (db as any).promptTemplate.create({
    data: {
      title: title.trim(),
      category,
      description: description.trim(),
      promptText: promptText.trim(),
      authorName: session.user.penName || session.user.name || '匿名作者',
      userId: session.user.id,
      isOfficial: false,
    },
  })

  return NextResponse.json({ item })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  const body = await req.json()
  const { id, action } = body
  if (!id || !['use', 'like'].includes(action)) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 })
  }

  const item = await (db as any).promptTemplate.update({
    where: { id },
    data: action === 'use' ? { useCount: { increment: 1 } } : { likesCount: { increment: 1 } },
  })

  return NextResponse.json({ item })
}
