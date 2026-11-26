import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOr401 } from '@/lib/auth'
import {
  createWritingStyle,
  DEFAULT_AI_AVOID_PHRASES,
  deleteWritingStyle,
  listWritingStyles,
  updateWritingStyle,
} from '@/lib/writing-style'

// GET /api/writing-styles - 获取当前用户的个人写作风格列表
export async function GET() {
  try {
    const session = await requireSessionOr401()
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

    const styles = await listWritingStyles(session.user.id)
    return NextResponse.json({ styles })
  } catch (e: any) {
    console.error('[GET /api/writing-styles]', e)
    return NextResponse.json({ error: e?.message || '获取写作风格失败' }, { status: 500 })
  }
}

// POST /api/writing-styles - 新建个人写作风格
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionOr401()
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
    const user = session.user

    const body = await req.json()
    const {
      name,
      description = '',
      stylePrompt = '',
      sampleText = '',
      avoidPhrases = DEFAULT_AI_AVOID_PHRASES,
      isDefault = false,
    } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: '风格名称不能为空' }, { status: 400 })
    }
    if (!stylePrompt?.trim() && !sampleText?.trim()) {
      return NextResponse.json({ error: '请填写文风要求或粘贴作者样文' }, { status: 400 })
    }

    const style = await createWritingStyle(user.id, {
      name: name.trim().slice(0, 40),
      description: String(description || '').trim().slice(0, 200),
      stylePrompt: String(stylePrompt || '').trim().slice(0, 3000),
      sampleText: String(sampleText || '').trim().slice(0, 3000),
      avoidPhrases: String(avoidPhrases || '').trim().slice(0, 1000),
      isDefault: Boolean(isDefault),
    })

    return NextResponse.json({ style })
  } catch (e: any) {
    console.error('[POST /api/writing-styles]', e)
    return NextResponse.json({ error: e?.message || '保存写作风格失败' }, { status: 500 })
  }
}

// PATCH /api/writing-styles - 更新个人写作风格
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSessionOr401()
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
    const user = session.user

    const body = await req.json()
    const { id, name, description, stylePrompt, sampleText, avoidPhrases, isDefault } = body
    if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

    const patch: Record<string, any> = {}
    if (name !== undefined) {
      if (!String(name).trim()) return NextResponse.json({ error: '风格名称不能为空' }, { status: 400 })
      patch.name = String(name).trim().slice(0, 40)
    }
    if (description !== undefined) patch.description = String(description || '').trim().slice(0, 200)
    if (stylePrompt !== undefined) patch.stylePrompt = String(stylePrompt || '').trim().slice(0, 3000)
    if (sampleText !== undefined) patch.sampleText = String(sampleText || '').trim().slice(0, 3000)
    if (avoidPhrases !== undefined) patch.avoidPhrases = String(avoidPhrases || '').trim().slice(0, 1000)
    if (isDefault !== undefined) patch.isDefault = Boolean(isDefault)

    const style = await updateWritingStyle(user.id, id, patch)
    if (!style) return NextResponse.json({ error: '未找到写作风格' }, { status: 404 })

    return NextResponse.json({ style })
  } catch (e: any) {
    console.error('[PATCH /api/writing-styles]', e)
    return NextResponse.json({ error: e?.message || '更新写作风格失败' }, { status: 500 })
  }
}

// DELETE /api/writing-styles?id=xxx - 删除个人写作风格
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSessionOr401()
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
    const user = session.user

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 })

    const ok = await deleteWritingStyle(user.id, id)
    if (!ok) return NextResponse.json({ error: '未找到写作风格' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[DELETE /api/writing-styles]', e)
    return NextResponse.json({ error: e?.message || '删除写作风格失败' }, { status: 500 })
  }
}
