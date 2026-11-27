import { createTransporter } from './email'

/**
 * 订单付款 / 到账通知管理员邮箱（默认 ljw33987@163.com）
 */
export async function sendAdminOrderNotification(params: {
  type: 'pending' | 'paid'
  orderId: string
  amount: number
  tokens: number
  method: string
  userEmail: string
  userName?: string | null
  redeemCode?: string
}): Promise<{ ok: boolean; error?: string }> {
  const result = await createTransporter()
  if (!result) return { ok: false, error: '邮件服务未配置或已禁用' }
  const { transporter, config } = result

  const toEmail = process.env.ADMIN_NOTIFY_EMAIL?.trim() || 'ljw33987@163.com'
  const methodLabel =
    params.method === 'wechat' ? '微信扫码' : params.method === 'alipay' ? '支付宝' : params.method
  const isPaid = params.type === 'paid'
  const subject = isPaid
    ? `【爆更猫AI写作】收款到账 ¥${params.amount.toFixed(2)}（${params.userName || params.userEmail}）`
    : `【爆更猫AI写作】新待确认订单 ¥${params.amount.toFixed(2)}（请核对收款）`

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.smtpUser}>`,
      to: toEmail,
      subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
          <div style="background: ${isPaid ? '#059669' : '#d97706'}; color: white; padding: 16px 20px; border-radius: 10px 10px 0 0;">
            <h2 style="margin: 0; font-size: 17px;">${isPaid ? '✅ 订单已确认到账' : '🔔 用户已提交扫码付款，请核对到账'}</h2>
          </div>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 10px 10px; font-size: 14px; color: #1f2937;">
            <p style="margin: 6px 0;"><strong>订单号：</strong><code>${params.orderId}</code></p>
            <p style="margin: 6px 0;"><strong>用户：</strong>${params.userName || '未设笔名'} (${params.userEmail})</p>
            <p style="margin: 6px 0;"><strong>支付方式：</strong>${methodLabel}</p>
            <p style="margin: 6px 0;"><strong>金额：</strong><span style="color: #dc2626; font-weight: bold;">¥${params.amount.toFixed(2)}</span></p>
            <p style="margin: 6px 0;"><strong>充值字数/Token：</strong>${params.tokens.toLocaleString()}</p>
            ${params.redeemCode ? `<div style="margin: 12px 0; padding: 12px; background: #fff; border: 1px dashed #6366f1; border-radius: 8px;"><strong>附带生成卡密：</strong><code style="font-size: 16px; color: #4f46e5;">${params.redeemCode}</code></div>` : ''}
            <p style="margin: 14px 0 0; font-size: 12px; color: #6b7280;">
              ${isPaid ? '系统已完成入账。' : '请在手机确认收到转账后，登录管理后台 → 订单管理点击「确认到账」。'}
            </p>
          </div>
        </div>
      `,
    })
    return { ok: true }
  } catch (e: any) {
    console.error('[Email] 发送订单通知失败:', e.message)
    return { ok: false, error: e.message }
  }
}
