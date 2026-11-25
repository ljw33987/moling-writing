import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOr401 } from '@/lib/auth'
import { assembleNovelContext } from '@/lib/context-assembler'

/**
 * POST /api/ai/preview - 预览上下文分层装配与 Token 预算预检
 */
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  const body = await req.json()
  const { novelId, chapterId, budgetTokens } = body
  if (!novelId) {
    return NextResponse.json({ error: '需要 novelId' }, { status: 400 })
  }

  const result = await assembleNovelContext({
    novelId,
    chapterId,
    budgetTokens: typeof budgetTokens === 'number' ? budgetTokens : 14000,
  })

  return NextResponse.json(result)
}
