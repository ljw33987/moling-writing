import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getEpayConfig, verifyEpaySign } from '@/lib/epay'
import { sendAdminOrderNotification } from '@/lib/email'

async function handleEpayNotify(params: Record<string, string>) {
  const epayConfig = getEpayConfig()
  if (!epayConfig) {
    return new NextResponse('fail', { status: 500 })
  }

  if (!verifyEpaySign(params, epayConfig.key)) {
    console.error('[Epay Notify] 验签失败', { out_trade_no: params.out_trade_no })
    return new NextResponse('fail', { status: 400 })
  }

  if (params.pid && params.pid !== epayConfig.pid) {
    return new NextResponse('fail', { status: 400 })
  }

  if (params.trade_status !== 'TRADE_SUCCESS') {
    return new NextResponse('success')
  }

  const outTradeNo = params.out_trade_no
  const money = parseFloat(params.money || '0')
  if (!outTradeNo) return new NextResponse('fail', { status: 400 })

  const order = await db.order.findUnique({ where: { id: outTradeNo } })
  if (!order) {
    return new NextResponse('fail', { status: 404 })
  }
  if (order.status === 'paid') {
    return new NextResponse('success')
  }
  if (Math.abs(order.amount - money) > 0.01) {
    console.error('[Epay Notify] 金额不匹配', { expected: order.amount, got: money })
    return new NextResponse('fail', { status: 400 })
  }

  const paidAt = new Date()
  const claimed = await db.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'paid', paidAt },
    })
    if (res.count !== 1) return false
    await tx.user.update({
      where: { id: order.userId },
      data: { tokens: { increment: order.tokens } },
    })
    return true
  })

  if (!claimed) {
    const latest = await db.order.findUnique({ where: { id: order.id }, select: { status: true } })
    return latest?.status === 'paid'
      ? new NextResponse('success')
      : new NextResponse('fail', { status: 409 })
  }

  console.log(`[Epay Notify] 支付成功: 订单 ${outTradeNo}, 金额 ¥${money}, Token +${order.tokens}`)
  const payer = await db.user.findUnique({ where: { id: order.userId }, select: { email: true, penName: true, name: true } })
  if (payer) {
    void sendAdminOrderNotification({
      type: 'paid',
      orderId: order.id,
      amount: order.amount,
      tokens: order.tokens,
      method: order.method,
      userEmail: payer.email,
      userName: payer.penName || payer.name,
    })
  }
  return new NextResponse('success')
}

// 易支付异步回调兼容 GET 与 POST
export async function GET(req: NextRequest) {
  const params: Record<string, string> = {}
  new URL(req.url).searchParams.forEach((v, k) => {
    params[k] = v
  })
  return handleEpayNotify(params)
}

export async function POST(req: NextRequest) {
  const params: Record<string, string> = {}
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => ({}))
    for (const [k, v] of Object.entries(json)) params[k] = String(v ?? '')
  } else {
    const formData = await req.formData().catch(() => null)
    formData?.forEach((v, k) => {
      params[k] = String(v)
    })
  }
  return handleEpayNotify(params)
}
