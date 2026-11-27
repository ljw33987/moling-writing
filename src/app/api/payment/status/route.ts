import { NextResponse } from 'next/server'
import { isPaymentAvailable } from '@/lib/payment'
import { isEpayAvailable } from '@/lib/epay'
import { db } from '@/lib/db'

// GET /api/payment/status - 检查支付是否可用（优先聚合支付，其次官方支付宝；附带个人收款码）
export async function GET() {
  const epay = isEpayAvailable()
  const alipay = await isPaymentAvailable()
  const provider = epay ? 'epay' : alipay ? 'alipay' : 'none'
  const qrRows = await db.$queryRaw<Array<{ wechatQrCode: string; alipayQrCode: string }>>`
    SELECT wechatQrCode, alipayQrCode FROM PlatformConfig WHERE id = 'default' LIMIT 1
  `.catch(() => [])
  const qr = qrRows[0]
  const qrCodes = {
    wechat: qr?.wechatQrCode || '',
    alipay: qr?.alipayQrCode || '',
  }
  return NextResponse.json({
    available: epay || alipay,
    provider,
    qrCodes,
  })
}
