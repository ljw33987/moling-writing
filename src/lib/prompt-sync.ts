import { db } from '@/lib/db'
import { OFFICIAL_PROMPTS } from '@/lib/official-prompts'

/**
 * 官方模板同步
 *
 * 旧实现只在表为空时播种一次，导致提示词文案更新后数据库里仍是旧版本。
 * 现在改为按标题做版本化 upsert：
 * - 官方模板内容变了就覆盖；
 * - 已下线的旧官方模板自动清理；
 * - 用户自己发布的模板（isOfficial=false）完全不受影响。
 */
let syncPromise: Promise<void> | null = null

/**
 * 官方模板的热度基数：给一组看起来真实的使用/点赞数（0~1000），
 * 避免模板市场里清一色 0；只对"从未被使用过"的官方模板生效，真实数据不受影响。
 */
function randomHeat(): { useCount: number; likesCount: number } {
  const likesCount = Math.floor(Math.random() * 1001)
  const useCount = Math.max(likesCount, Math.floor(Math.random() * 1001))
  return { useCount, likesCount }
}

export async function syncOfficialPrompts(): Promise<void> {
  if (!syncPromise) {
    syncPromise = (async () => {
      const existing = await (db as any).promptTemplate.findMany({
        where: { isOfficial: true },
        select: {
          id: true,
          title: true,
          category: true,
          description: true,
          promptText: true,
          useCount: true,
          likesCount: true,
        },
      })
      const byTitle = new Map<string, any>(existing.map((r: any) => [r.title, r]))
      const keepTitles = new Set(OFFICIAL_PROMPTS.map((p) => p.title))

      for (const p of OFFICIAL_PROMPTS) {
        const row = byTitle.get(p.title)
        const data = {
          title: p.title,
          category: p.category,
          description: p.description,
          promptText: p.promptText,
          authorName: p.authorName,
          isOfficial: true,
        }
        if (row) {
          const contentChanged =
            row.category !== p.category ||
            row.description !== p.description ||
            row.promptText !== p.promptText
          // 从未被使用/点赞过的官方模板，补一组随机热度基数
          const needHeat = (row.useCount || 0) === 0 && (row.likesCount || 0) === 0
          if (contentChanged || needHeat) {
            await (db as any).promptTemplate.update({
              where: { id: row.id },
              data: { ...data, ...(needHeat ? randomHeat() : {}) },
            })
          }
        } else {
          await (db as any).promptTemplate.create({
            data: { ...data, ...randomHeat() },
          })
        }
      }

      // 清理已下线的旧版官方模板
      for (const row of existing) {
        if (!keepTitles.has(row.title)) {
          await (db as any).promptTemplate.delete({ where: { id: row.id } })
        }
      }
    })().catch((e) => {
      console.error('[prompts] 官方模板同步失败：', e)
      syncPromise = null
    })
  }
  await syncPromise
}

/** 官方模板按内置顺序稳定展示，用户模板按热度排在后面 */
export function sortPromptTemplates(items: any[]): any[] {
  const officialOrder = new Map(OFFICIAL_PROMPTS.map((p, idx) => [p.title, idx]))
  return items.sort((a: any, b: any) => {
    const aOfficial = a.isOfficial ? 0 : 1
    const bOfficial = b.isOfficial ? 0 : 1
    if (aOfficial !== bOfficial) return aOfficial - bOfficial
    if (aOfficial === 0) {
      const ai = officialOrder.get(a.title) ?? Number.MAX_SAFE_INTEGER
      const bi = officialOrder.get(b.title) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
    }
    return (b.useCount || 0) - (a.useCount || 0)
  })
}
