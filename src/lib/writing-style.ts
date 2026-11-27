import { randomUUID } from 'crypto'
import { db } from '@/lib/db'

export const DEFAULT_AI_AVOID_PHRASES =
  '不禁、仿佛、然而、嘴角微微上扬、一抹、眼神微眯、空气仿佛凝固、深吸一口气、心中五味杂陈、宛如、不由自主、值得一提的是、总而言之、在这一刻、悄然、骤然、陡然、蓦然、泛起一丝、划过一抹、嘴角勾起、眼底闪过、空气中弥漫着'

/**
 * 默认人类自然口吻铁律：即使作者未绑定自定义文风，写正文时也强制注入，
 * 消除翻译腔、总结腔、播音腔对白与机械排比。
 */
export const HUMAN_VOICE_SYSTEM_RULES = `【人类自然口吻与去 AI 味铁律】
1. 像真人在写故事、像活人在说话：对话要有口语停顿、打断、反问、情绪潜台词，严禁角色像播音员一样长篇大论讲道理。
2. 用具体动作、眼神与生活细节推进情绪，严禁“这让他心中五味杂陈”“空气仿佛凝固”“命运的齿轮开始转动”等空洞总结句。
3. 句式长短错落，多用短句与动词，严禁连续三句结构对称的排比，严禁段首高频使用“然而/不过/与此同时/紧接着”。
4. 严禁使用高频 AI 套话：${DEFAULT_AI_AVOID_PHRASES}。`

export interface WritingStyleData {
  id: string
  name: string
  description: string
  stylePrompt: string
  sampleText: string
  avoidPhrases: string
  isDefault?: boolean
}

function hasWritingStyleDelegate(): boolean {
  return Boolean((db as any).writingStyle)
}

export async function listWritingStyles(userId: string): Promise<WritingStyleData[]> {
  if (hasWritingStyleDelegate()) {
    return (db as any).writingStyle.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    })
  }
  const rows = await db.$queryRawUnsafe<any[]>(
    `SELECT id, name, description, stylePrompt, sampleText, avoidPhrases, isDefault
     FROM WritingStyle WHERE userId = ? ORDER BY isDefault DESC, updatedAt DESC`,
    userId
  )
  return rows.map((r) => ({ ...r, isDefault: Boolean(r.isDefault) }))
}

export async function createWritingStyle(
  userId: string,
  input: {
    name: string
    description: string
    stylePrompt: string
    sampleText: string
    avoidPhrases: string
    isDefault: boolean
  }
): Promise<WritingStyleData> {
  if (hasWritingStyleDelegate()) {
    if (input.isDefault) {
      await (db as any).writingStyle.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      })
    }
    return (db as any).writingStyle.create({
      data: { userId, ...input },
    })
  }

  if (input.isDefault) {
    await db.$executeRawUnsafe(
      `UPDATE WritingStyle SET isDefault = 0 WHERE userId = ? AND isDefault = 1`,
      userId
    )
  }
  const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 20)}`
  const now = new Date().toISOString()
  await db.$executeRawUnsafe(
    `INSERT INTO WritingStyle (id, userId, name, description, stylePrompt, sampleText, avoidPhrases, isDefault, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    input.name,
    input.description,
    input.stylePrompt,
    input.sampleText,
    input.avoidPhrases,
    input.isDefault ? 1 : 0,
    now,
    now
  )
  return { id, ...input }
}

export async function updateWritingStyle(
  userId: string,
  id: string,
  patch: Partial<{
    name: string
    description: string
    stylePrompt: string
    sampleText: string
    avoidPhrases: string
    isDefault: boolean
  }>
): Promise<WritingStyleData | null> {
  if (hasWritingStyleDelegate()) {
    const existing = await (db as any).writingStyle.findFirst({ where: { id, userId } })
    if (!existing) return null
    if (patch.isDefault) {
      await (db as any).writingStyle.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }
    return (db as any).writingStyle.update({ where: { id }, data: patch })
  }

  const existing = await db.$queryRawUnsafe<any[]>(
    `SELECT id, name, description, stylePrompt, sampleText, avoidPhrases, isDefault
     FROM WritingStyle WHERE id = ? AND userId = ? LIMIT 1`,
    id,
    userId
  )
  if (!existing.length) return null

  if (patch.isDefault) {
    await db.$executeRawUnsafe(
      `UPDATE WritingStyle SET isDefault = 0 WHERE userId = ? AND isDefault = 1 AND id != ?`,
      userId,
      id
    )
  }

  const next = {
    name: patch.name ?? existing[0].name,
    description: patch.description ?? existing[0].description,
    stylePrompt: patch.stylePrompt ?? existing[0].stylePrompt,
    sampleText: patch.sampleText ?? existing[0].sampleText,
    avoidPhrases: patch.avoidPhrases ?? existing[0].avoidPhrases,
    isDefault: patch.isDefault !== undefined ? Boolean(patch.isDefault) : Boolean(existing[0].isDefault),
  }

  await db.$executeRawUnsafe(
    `UPDATE WritingStyle
     SET name = ?, description = ?, stylePrompt = ?, sampleText = ?, avoidPhrases = ?, isDefault = ?, updatedAt = ?
     WHERE id = ? AND userId = ?`,
    next.name,
    next.description,
    next.stylePrompt,
    next.sampleText,
    next.avoidPhrases,
    next.isDefault ? 1 : 0,
    new Date().toISOString(),
    id,
    userId
  )
  return { id, ...next }
}

export async function deleteWritingStyle(userId: string, id: string): Promise<boolean> {
  if (hasWritingStyleDelegate()) {
    const existing = await (db as any).writingStyle.findFirst({ where: { id, userId } })
    if (!existing) return false
    await (db.novel as any).updateMany({
      where: { userId, writingStyleId: id },
      data: { writingStyleId: null },
    })
    await (db as any).writingStyle.delete({ where: { id } })
    return true
  }

  const existing = await db.$queryRawUnsafe<any[]>(
    `SELECT id FROM WritingStyle WHERE id = ? AND userId = ? LIMIT 1`,
    id,
    userId
  )
  if (!existing.length) return false

  await db.$executeRawUnsafe(
    `UPDATE Novel SET writingStyleId = NULL WHERE userId = ? AND writingStyleId = ?`,
    userId,
    id
  )
  await db.$executeRawUnsafe(`DELETE FROM WritingStyle WHERE id = ? AND userId = ?`, id, userId)
  return true
}

export async function getNovelWritingStyleId(userId: string, novelId: string): Promise<string | null> {
  const rows = await db.$queryRawUnsafe<Array<{ writingStyleId: string | null }>>(
    `SELECT writingStyleId FROM Novel WHERE id = ? AND userId = ? LIMIT 1`,
    novelId,
    userId
  )
  return rows[0]?.writingStyleId || null
}

export async function setNovelWritingStyleId(
  userId: string,
  novelId: string,
  writingStyleId: string | null
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE Novel SET writingStyleId = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
    writingStyleId,
    new Date().toISOString(),
    novelId,
    userId
  )
}

/**
 * 将个人写作风格组装为高优先级的系统提示词，
 * 通过「文风规则 + 禁用 AI 套话 + 作者样文 Few-shot」消除千篇一律的 AI 味。
 */
export function buildWritingStyleInstruction(style: WritingStyleData | null | undefined): string {
  if (!style) return ''

  const parts: string[] = [
    `【作者专属写作风格：${style.name}】`,
    '请严格按照以下个人文风进行创作与改写，保持自然真实的人类作者笔触，杜绝机械对称排比、空洞抒情总结与说教式收尾：',
  ]

  if (style.stylePrompt?.trim()) {
    parts.push(`1. 文风与叙事要求：\n${style.stylePrompt.trim()}`)
  }

  const avoid = (style.avoidPhrases || '').trim()
  if (avoid) {
    parts.push(`2. 严禁使用以下高频 AI 套话与陈词滥调（请用具体动作、细节或口语化表达替代）：\n${avoid}`)
  }

  if (style.sampleText?.trim()) {
    const excerpt = style.sampleText.trim().slice(0, 2000)
    parts.push(
      `3. 作者样文参照（请重点模仿其句式长短、断句节奏、对话口吻与用词习惯，切勿照抄样文剧情与人名）：\n"""\n${excerpt}\n"""`
    )
  }

  return parts.join('\n\n')
}

/**
 * 按优先级解析本次创作应使用的个人写作风格：
 * 1) 显式指定的 writingStyleId（"none" 表示本次不使用任何个人风格）
 * 2) 作品绑定的 writingStyleId
 * 3) 若未传 novelId，则返回 null（不强行覆盖非作品场景）
 */
export async function resolveWritingStyleForNovel(
  userId: string,
  novelId?: string | null,
  explicitStyleId?: string | null
): Promise<WritingStyleData | null> {
  if (explicitStyleId === 'none') return null

  let targetId = explicitStyleId || null
  if (!targetId && novelId) {
    targetId = await getNovelWritingStyleId(userId, novelId)
  }

  if (!targetId) return null

  if (hasWritingStyleDelegate()) {
    const style = await (db as any).writingStyle.findFirst({
      where: { id: targetId, userId },
      select: {
        id: true,
        name: true,
        description: true,
        stylePrompt: true,
        sampleText: true,
        avoidPhrases: true,
      },
    })
    return style || null
  }

  const rows = await db.$queryRawUnsafe<WritingStyleData[]>(
    `SELECT id, name, description, stylePrompt, sampleText, avoidPhrases
     FROM WritingStyle WHERE id = ? AND userId = ? LIMIT 1`,
    targetId,
    userId
  )
  return rows[0] || null
}
