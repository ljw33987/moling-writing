import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { hasProAiAccess, parseModelMappings, toPublicModels } from '@/lib/ai-models'

// GET /api/ai/models - 返回后台映射后的对外模型名称（绝不暴露 deepseek-chat / minimax 等真实底层模型名）
export async function GET() {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const userPlan = session.user.plan || 'free'
  const isPaidMember = hasProAiAccess(userPlan)
  const config = await db.platformConfig.findUnique({ where: { id: 'default' } })
  const mappings = parseModelMappings((config as any)?.modelMappings)
  const models = toPublicModels(mappings).map((m) => ({
    ...m,
    locked: !!m.isPro && !isPaidMember,
  }))

  return NextResponse.json({ models, userPlan })
}
