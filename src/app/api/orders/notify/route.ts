import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { sendAdminOrderNotification } from '@/lib/order-email'
import { checkRateLimit } from '@/lib/concurrency'

// POST /api/orders/notify - 用户点击“我已扫码付款”后发邮件通知管理员核对
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionOr401()
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
    const user = session.user

    const rl = checkRateLimit(`order-notify:${user.id}`, 10, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: '通知过于频繁，请稍候' }, { status: 429 })
    }

    const { orderId } = await req.json()
    if (!orderId) return NextResponse.json({ error: '需要 orderId' }, { status: 400 })

    const order = await db.order.findUnique({ where: { id: orderId } })
    if (!order || order.userId !== user.id) {
      return NextResponse.json({ error: '订单不存在' }, { status: 404 })
    }

    const mailRes = await sendAdminOrderNotification({
      type: 'pending',
      orderId: order.id,
      amount: order.amount,
      tokens: order.tokens,
      method: order.method,
      userEmail: user.email,
      userName: user.penName || user.name,
    })

    return NextResponse.json({ ok: true, emailed: mailRes.ok, emailError: mailRes.error })
  } catch (e: any) {
    console.error('[orders/notify] error:', e)
    return NextResponse.json({ error: e?.message || '通知失败' }, { status: 500 })
  }
}
