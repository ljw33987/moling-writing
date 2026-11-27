import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'
import { buildEpayPayUrl, getEpayConfig } from '@/lib/epay'
import { getPackages } from '@/app/api/orders/route'

// POST /api/payment/epay/create - 聚合支付下单（支持微信 wxpay / 支付宝 alipay）
export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 401 })
  const user = session.user

  const epayConfig = getEpayConfig()
  if (!epayConfig) {
    return NextResponse.json(
      { error: '聚合支付未配置，请在 .env 中设置 EPAY_API_URL、EPAY_PID、EPAY_KEY' },
      { status: 503 }
    )
  }

  const body = await req.json()
  const { packageId, method = 'alipay' } = body
  const payMethod: 'alipay' | 'wechat' = method === 'wechat' ? 'wechat' : 'alipay'

  const packages = await getPackages()
  const pkg = packages.find((p) => p.id === packageId)
  if (!pkg) return NextResponse.json({ error: '套餐不存在' }, { status: 400 })

  const order = await db.order.create({
    data: {
      userId: user.id,
      amount: pkg.price,
      tokens: pkg.tokens,
      method: payMethod,
      status: 'pending',
    },
  })

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
  const payUrl = buildEpayPayUrl(epayConfig, {
    orderId: order.id,
    amount: pkg.price,
    subject: `爆更猫AI写作 - ${pkg.name}（${pkg.tokens.toLocaleString()}字数额度）`,
    method: payMethod,
    notifyUrl: `${baseUrl}/api/payment/epay/notify`,
    returnUrl: `${baseUrl}/api/payment/alipay/return?out_trade_no=${order.id}`,
  })

  return NextResponse.json({
    orderId: order.id,
    payUrl,
    method: payMethod,
  })
}
