import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminOr401 } from '@/lib/auth'
import { resolveUpgradedPlan } from '@/app/api/orders/route'

export async function GET(req: NextRequest) {
  const session = await requireAdminOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20')

  const [orders, total] = await Promise.all([
    db.order.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, penName: true } },
      },
    }),
    db.order.count(),
  ])

  // 统计
  const paidOrders = await db.order.aggregate({
    where: { status: 'paid' },
    _sum: { amount: true, tokens: true },
    _count: true,
  })

  return NextResponse.json({
    orders,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    stats: {
      paidCount: paidOrders._count,
      paidAmount: paidOrders._sum.amount || 0,
      paidTokens: paidOrders._sum.tokens || 0,
    },
  })
}

// PATCH /api/admin/orders - 管理员一键确认到账或取消订单
export async function PATCH(req: NextRequest) {
  const session = await requireAdminOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })

  const body = await req.json()
  const { id, action = 'confirm' } = body
  if (!id) return NextResponse.json({ error: '需要订单 id' }, { status: 400 })

  const order = await db.order.findUnique({ where: { id } })
  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 })

  if (action === 'cancel') {
    const res = await db.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'failed' },
    })
    if (res.count !== 1) {
      return NextResponse.json({ error: '该订单状态已变更，无法取消' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: 'failed' })
  }

  if (order.status === 'paid') {
    return NextResponse.json({ error: '订单已到账，无需重复确认' }, { status: 400 })
  }

  const paidAt = new Date()
  const claimed = await db.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'paid', paidAt },
    })
    if (res.count !== 1) return false
    const targetUser = await tx.user.findUnique({ where: { id: order.userId }, select: { plan: true } })
    const nextPlan = resolveUpgradedPlan(targetUser?.plan || 'free', order.amount)
    await tx.user.update({
      where: { id: order.userId },
      data: {
        tokens: { increment: order.tokens },
        ...(nextPlan ? { plan: nextPlan } : {}),
      },
    })
    return true
  })

  if (!claimed) {
    return NextResponse.json({ error: '订单已被处理，请刷新列表' }, { status: 409 })
  }

  const updatedUser = await db.user.findUnique({
    where: { id: order.userId },
    select: { tokens: true },
  })
  return NextResponse.json({
    ok: true,
    status: 'paid',
    paidAt,
    newBalance: updatedUser?.tokens,
  })
}
