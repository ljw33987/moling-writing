import crypto from 'crypto'

export interface EpayConfig {
  apiUrl: string
  pid: string
  key: string
}

/**
 * 从环境变量读取易支付（通用聚合支付）配置
 */
export function getEpayConfig(): EpayConfig | null {
  const apiUrl = process.env.EPAY_API_URL?.trim().replace(/\/$/, '')
  const pid = process.env.EPAY_PID?.trim()
  const key = process.env.EPAY_KEY?.trim()
  if (!apiUrl || !pid || !key) return null
  return { apiUrl, pid, key }
}

export function isEpayAvailable(): boolean {
  return !!getEpayConfig()
}

/**
 * 标准易支付 MD5 签名：
 * 过滤空值与 sign/sign_type，按 key ASCII 升序拼接 k=v&... + key 后取小写 MD5
 */
export function signEpayParams(params: Record<string, string | number | undefined>, secretKey: string): string {
  const sortedKeys = Object.keys(params)
    .filter((k) => {
      if (k === 'sign' || k === 'sign_type') return false
      const val = params[k]
      return val !== undefined && val !== null && String(val) !== ''
    })
    .sort()

  const queryStr = sortedKeys.map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('md5').update(`${queryStr}${secretKey}`).digest('hex').toLowerCase()
}

/**
 * 校验易支付回调签名（恒定时间比较，防时序攻击）
 */
export function verifyEpaySign(params: Record<string, string>, secretKey: string): boolean {
  const givenSign = (params.sign || '').toLowerCase()
  if (!givenSign) return false
  const expected = signEpayParams(params, secretKey)
  if (givenSign.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(givenSign), Buffer.from(expected))
}

/**
 * 构造易支付收银台跳转链接
 */
export function buildEpayPayUrl(
  config: EpayConfig,
  opts: {
    orderId: string
    amount: number
    subject: string
    method: 'alipay' | 'wechat'
    notifyUrl: string
    returnUrl: string
  }
): string {
  const params: Record<string, string> = {
    pid: config.pid,
    type: opts.method === 'wechat' ? 'wxpay' : 'alipay',
    out_trade_no: opts.orderId,
    notify_url: opts.notifyUrl,
    return_url: opts.returnUrl,
    name: opts.subject,
    money: opts.amount.toFixed(2),
    sign_type: 'MD5',
  }
  params.sign = signEpayParams(params, config.key)

  const qs = new URLSearchParams(params).toString()
  return `${config.apiUrl}/submit.php?${qs}`
}
