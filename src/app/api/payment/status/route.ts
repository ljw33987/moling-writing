import { NextResponse } from 'next/server'
import { isPaymentAvailable } from '@/lib/payment'
import { isEpayAvailable } from '@/lib/epay'

// GET /api/payment/status - 检查支付是否可用（优先聚合支付，其次官方支付宝）
export async function GET() {
  const epay = isEpayAvailable()
  const alipay = await isPaymentAvailable()
  const provider = epay ? 'epay' : alipay ? 'alipay' : 'none'
  return NextResponse.json({
    available: epay || alipay,
    provider,
  })
}
