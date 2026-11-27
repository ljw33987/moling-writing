import { db } from '@/lib/db'

interface RateLimitEntry {
  timestamps: number[]
}

const globalForConcurrency = globalThis as unknown as {
  __molingRateLimits?: Map<string, RateLimitEntry>
  __molingActiveAiSlots?: Map<string, number>
}

const rateLimitStore =
  globalForConcurrency.__molingRateLimits ??
  (globalForConcurrency.__molingRateLimits = new Map<string, RateLimitEntry>())

const activeAiSlots =
  globalForConcurrency.__molingActiveAiSlots ??
  (globalForConcurrency.__molingActiveAiSlots = new Map<string, number>())

/**
 * 滑动窗口限流（单机内存版；多实例部署时可替换为 Redis INCR/ZSET）
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { ok: boolean; retryAfterSec: number; remaining: number } {
  const now = Date.now()
  const cutoff = now - windowMs

  // 定期清理过期 key，防止内存无限增长
  if (rateLimitStore.size > 5000) {
    for (const [k, v] of rateLimitStore.entries()) {
      const kept = v.timestamps.filter((t) => t > cutoff)
      if (kept.length === 0) rateLimitStore.delete(k)
      else v.timestamps = kept
    }
  }

  const entry = rateLimitStore.get(key) ?? { timestamps: [] }
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0] ?? now
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    rateLimitStore.set(key, entry)
    return { ok: false, retryAfterSec, remaining: 0 }
  }

  entry.timestamps.push(now)
  rateLimitStore.set(key, entry)
  return {
    ok: true,
    retryAfterSec: 0,
    remaining: Math.max(0, maxRequests - entry.timestamps.length),
  }
}

/**
 * 单用户并发 AI 请求槽位控制（防止同一账号同时开大量流式请求打满连接池/上游配额）
 */
export function acquireUserAiSlot(
  userId: string,
  maxConcurrent = 3
): { ok: true; release: () => void } | { ok: false; active: number } {
  const current = activeAiSlots.get(userId) ?? 0
  if (current >= maxConcurrent) {
    return { ok: false, active: current }
  }
  activeAiSlots.set(userId, current + 1)

  let released = false
  return {
    ok: true,
    release: () => {
      if (released) return
      released = true
      const nowCount = activeAiSlots.get(userId) ?? 1
      if (nowCount <= 1) activeAiSlots.delete(userId)
      else activeAiSlots.set(userId, nowCount - 1)
    },
  }
}

/**
 * 原子预扣 Token：使用带条件的 updateMany 防止高并发下同一账号超扣或扣成负数
 */
export async function reserveUserTokens(
  userId: string,
  reserveAmount = 200
): Promise<{ ok: true; reserved: number } | { ok: false }> {
  const res = await db.user.updateMany({
    where: { id: userId, tokens: { gte: reserveAmount } },
    data: { tokens: { decrement: reserveAmount } },
  })
  if (res.count === 1) {
    return { ok: true, reserved: reserveAmount }
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { tokens: true },
  })
  if (!user || user.tokens <= 0) {
    return { ok: false }
  }

  const partial = Math.min(user.tokens, reserveAmount)
  const retry = await db.user.updateMany({
    where: { id: userId, tokens: { gte: partial } },
    data: { tokens: { decrement: partial } },
  })
  if (retry.count === 1) {
    return { ok: true, reserved: partial }
  }

  return { ok: false }
}

/**
 * 结算 Token：多退少补，并保证余额永远 >= 0；AI 失败时传 actualUsed = 0 即全额退回
 */
export async function settleUserTokens(
  userId: string,
  reserved: number,
  actualUsed: number
): Promise<number> {
  const diff = reserved - actualUsed
  if (diff > 0) {
    const updated = await db.user.update({
      where: { id: userId },
      data: { tokens: { increment: diff } },
      select: { tokens: true },
    })
    return updated.tokens
  }

  if (diff < 0) {
    const extra = -diff
    const dec = await db.user.updateMany({
      where: { id: userId, tokens: { gte: extra } },
      data: { tokens: { decrement: extra } },
    })
    if (dec.count === 0) {
      await db.user.update({
        where: { id: userId },
        data: { tokens: 0 },
      })
      return 0
    }
  }

  const latest = await db.user.findUnique({
    where: { id: userId },
    select: { tokens: true },
  })
  return latest?.tokens ?? 0
}
