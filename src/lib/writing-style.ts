import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { AI_BANNED_PHRASES, AI_CAUTION_PHRASES } from '@/lib/ai-tells'

const DEFAULT_AI_AVOID_PHRASES = [...AI_BANNED_PHRASES, ...AI_CAUTION_PHRASES].join('、')

// 兼容开发服务热更新期间仍引用旧导出的模块依赖图。
export const HUMAN_VOICE_SYSTEM_RULES = `【默认正文文风】
1. 沿用前文的叙述视角、角色口吻和句段节奏。根据场景使用动作、细节、对白或心理描写。
2. 避免无意义的总结、翻译腔、机械排比和重复衔接。以下词语容易形成套话，结合上下文判断：${DEFAULT_AI_AVOID_PHRASES}。
3. 写情绪先想「这个人在此刻会做什么」：只写动作、身体反应与现场声响，不写「他感到 XX」；同一种情绪只写一次，不反复渲染。
4. 不用排比和对仗凑气势：同一句内不连排三个以上同结构短语，连续两段不用同一句式开头；删掉只承上启下的过渡句（与此同时、就这样、时间一天天过去），场景直接切。
5. 同一角色在不同场景的反应不能是同一套：不套「眸光一闪」「嘴角勾起」「面色铁青」这类万能反应，反应跟着当下处境走。
6. 每章允许 1—2 处不推动剧情的琐碎细节（桌上的水渍、窗外响了一声又没了）；章末钩子落在尚未解决的事件上，不落在感慨和总结句上。
7. 对白像真人吵架：长台词拆成两截，中间插一个动作（他往后撤了半步，灯笼往身前一挡）；连续四句以上纯对白补一个动作打断；紧张、撒谎、回避的角色允许口吃、重复上一个词、说错再改口。`

/**
 * 描写与对白专项规则
 *
 * 环境、说话描写、对话这三类在上一轮规则里完全没覆盖，实测改写时它们经常原封不动。
 * 这里按三类各自的病灶给改法，并且都写成「先判断、再动手」的形式，避免模型无差别删改。
 */
export const PROSE_DESCRIPTION_RULES = `【环境描写】
- 每段环境必须承担一项：给出行动条件（光、地面、温度、噪音、遮挡），或出现一个能被人物碰到的物件，或落在人物的生理感受上。三样都不沾就整段删掉。
- 环境的落点必须是物理量，不要接到心情上：删掉「死寂」「沉寂」「压抑」「窒息」「令人发寒」「弥漫着」，换成看得见、听得见、摸得着的东西。
- 同一场景里天气与背景意象（雪、风、雾、光、灯火、月）各自最多出现两次，之后改写被它影响的具体东西（肩上的雪化成水、脚印被新雪填平）。
- 环境里至少要有一个正在发生的变化：光在移、水在滴、影子在走、雪在落；写完就静止的摆拍静物段（挂好灯泡、铺好月光之后句子就停了），补一个变化或删短。
- 一章安排 1—2 处非视觉感官（气味：消毒水、油烟、雨前的土腥；触感：椅面的凉、把手的黏），落在人物的动作上（他闻到焦味才停脚）；不硬塞，连续三段只有「看到」时才需要打散。
- 用具体替代概括：「一片昏黄灯火」改成「杆子上挂着的七八只灯泡」。
- 正样本照着写：具体物件加动作留得住（「雪地上留下他那盏裂成两半的青铜灯笼，在风里滴溜溜打转」），光源带出人物（「雪幕深处，三道提着青铜灯笼的黑影踏雪而来」）；拿不准就照这两个样子写。
- 删装饰性类比：「破庙般的残垣」「刀削般的山崖」这类「X般的Y」只是给普通东西贴装饰，直接写东西本身；要留就留带信息量的类比。
- 不套现成句模子：「寒风卷着X灌进Y」「月光如水洒在X」这类固定开头换一个起手，或从人物动作切入环境。

【说话描写】
- 一档动作提示（他放下杯子）保留；二档修饰型提示（冷笑道、轻声说、淡淡地说、似乎觉得有些好笑）删掉修饰，只留动作或动词；三档声音标签与音量说明（声音温润得令人发寒、嘶哑得像从喉管深处挤出来、声音不高刚好够听见）默认删掉，全章最多留一处。声音描写的主语不限于「声音」：嗓子、嗓门、话音、口吻、腔调开头的写法（「嗓子沙哑，像卡着碎玻璃」「嗓门压得很低」）按同一套规则处理。
- 删掉声音标签后不要另造比喻顶上：原来是「声音温润得令人发寒」就改成「他笑了一声」或让台词自己带出敌意；原来是「声音嘶哑」就改成「他嗓子哑了，咳了一声才说完」。
- 需要表达情绪时改用可听见的物理细节：停顿、吞咽、牙齿咬紧、气息断了一下、尾音被截断。
- 不要用「跟…似的」「像…一样」「裹着…的」去形容人的声音或语气；「像卡着碎玻璃」「像裹了蜜的刀」这类不带"似的"的短比喻同样算声音比喻；比作具体物理声源（脚步、门轴、雨声）才可以。
- 一段对白前的提示语最多一层，不要「声音彻底冷下来，他缓缓抬手，指尖夹着三根乌黑的细钉」这样情绪、动作、细节三层叠加。

【对白】
- 改之前先在心里给每个角色定一张语言卡：句长偏好、逻辑方式、口头禅、绝不会说的话、说话小动作、对不同对象的差别。
- 一场对话里只有一个人有资格解释设定与计划；其他人只做事、抢话、沉默、走神。
- 台词不要替作者讲道理，也不要复述对方已经知道的事；允许说一半、被打断、答非所问、用动作代替回答。
- 人物嘴里不要出现书面语与文言腔（缓缓、蓦地、何以、休想、尔等），改成口语；真人会说「呢、吧、啊、嗯、呀」。
- 反派的威胁要有具体利益和具体后果，不要温润的文言腔与条件宣言（「今夜便别再让师兄费心了」「说出来的话，师兄给你留个全尸」这类书面反派腔）；改成口语加具体画面：「小师妹，三年不见，怎么跪得跟条丧家犬似的？」
- 不用宣言+威胁升级收尾（「你躲得了一时躲不了一世！三天后子时，断碑前见！不来——我就把剑阁那些坟都刨了！」）；威胁只落在一件具体的事上，最后一句用动作收：「他把剑在碑上磕了磕。三天后子时，断碑前见。」
- 长台词拆成两截，中间插一个动作：「亡魂听令？」他往后撤了半步，灯笼往身前一挡，「你竟然修了九幽引魂术？」；连续四句以上纯对白没有任何动作、环境或停顿穿插，就补一个动作打断，不要写成话剧剧本。`

/**
 * 正文精修规则 v2
 *
 * 相比旧版补的是「结构层」：旧版只有词层禁令和「保留剧情」的底线，模型据此只能做删词手术，
 * 删完句子照样一样长、段落照样一样整齐，读起来更像一篇更干净 AI。
 * 这里按病灶给出「信号 → 改法」，并补上剂量上限与终稿自检。
 */
export const PROSE_REFINEMENT_RULES = `【正文精修要求】
- 保留原有剧情、顺序、人物设定、对白信息和关键细节，篇幅保持与原稿接近。
- 先判断问题是否真实存在，只修改机械复述、无依据总结、语气漂移、生硬因果和连续同构句；保留有功能的重复、留白、口头禅与题材惯用表达。
- 按本次文风修正表达，不要把全部句子强行改短，也不要为了“画面感”无依据地添加动作、比喻、心理活动或环境描写。
- 对话应符合人物身份、关系和当下目的，避免把潜台词改成解释说明。
- 直接输出精修结果，不附解释或修改说明。

【去 AI 味 · 结构层（按这个顺序改，先改结构再改词）】
1. 情绪报账：删掉直接命名情绪的句子（心中一紧、涌上心头、五味杂陈、感到一阵恐惧），换成身体反应、手上的动作或现场声响。
2. 意义膨胀：删掉给普通事贴标签的句子（意义深远、前所未有、这一刻他终于明白了、命运的齿轮），改写事件本身带来的后果。
3. 论文腔：段落不要以「不难看出 / 事实上 / 值得注意的是 / 与此同时 / 总而言之」开头，直接从动作、感知、对白写起。
4. 段落同构：不要每段都是「主题句—展开—总结」，允许一段只写一个动作、一句停顿、一段对白。
5. 句长打散：不要连续三句长度接近；长句后放一个短句，允许一两个字的独立短段。
6. 对话千人一面：人物不替作者讲设定、复述计划或解释自己刚想通的事；允许说一半、说岔、沉默、用动作代替回答。
7. 允许不完美：允许语气词（嗯、吧、说真的）、重复、碎片句和不那么漂亮的句子；真人写的文字有毛边。
8. 具体优先：抽象的「某种力量 / 难以言喻 / 无形的感觉」换成可感知的具体物（温度、声音、触感、时间、数字）。
9. 标点克制：破折号不超过 2 处；不要每句都带感叹号或问号。
10. 不许同义反复：同一段不要用「重要 / 关键 / 核心 / 根本」反复修饰同一个对象，也不要换个说法把同一件事再说一遍。
11. 留一处无用细节：允许 1—2 处「不为什么」的细节（墙上的钉子、桌沿的水渍、窗外响了一声又没了），人味就在这里。
12. 不要为了「改得像人」而在原句上另造比喻顶上；新写的句子也要过一遍同样的检查。
13. 排比与对仗：删掉三连排比和对仗结构（「他的声音很轻，动作很快，眼神很冷」只挑一个写）；连续两段用同一句式开头也要打散。
14. 过渡句与过渡段：只负责承上启下的句子和段落（「就这样」「与此同时，另一边」「时间一天天过去」）直接删，场景硬切；删掉后确认信息没丢再动下一处。
15. 万能反应：同一个角色在不同场景里用同一套反应（每次都眸光一闪、勾起嘴角、面色铁青）要改；反应跟着当下处境走，不套模板。
16. 同角色反应复读：同一角色每次受挫都用同一套身体反应（喉结滚了两回、腮帮子抽搐、横肉抖了三回——同一个人抖了五回）要改；一个角色的同类反应全章最多两次，之后换别的表现或不写。
17. 规则即发即用：冲突的解法不能靠现场冒出的新规则/新批注/新条款；关键规则必须在生效前至少埋过一次线索，胜利要靠「早看懂的规则」。
18. 群像代言：弹幕、围观人群不许替读者总结、发笑或夸主角；只写具体行为，每两三次反转才来一轮反应，允许有人反应错位。
19. 清单化叙事：叙事不许写成记账——物品清单、收益结算、属性面板、顿号罗列的数字串（背包里有绳索、匕首、三瓶药剂）只保留对剧情有作用的一两项并给细节，其余一句概括或删；面板/结算只许出现在题材设定内的真实系统场景，且不写成流水账。

${PROSE_DESCRIPTION_RULES}

【改写剂量】
能改一个词就不改一句，能删一句就不重写一段；没有指认的问题保持原样，不要通篇改写。
删的是修饰，不是动作：灯笼往身前一挡、卷起袖子这类动作带信息，不要当成修饰删掉。
删掉提示语修饰后如果角色变没脾气，把情绪搬到动作上，不要把修饰词加回来。`

/** 终稿自检：改完再问一遍「哪里一眼是 AI」，这一步压住 AI 味最有效 */
export const PROSE_FINAL_AUDIT_RULES = `【终稿自检（改完必须做一遍）】
1. 逐条对照上面机器体检点名的位置，确认每一处都真的改了；没改的当场改掉。
2. 再扫一遍禁用词与套话（仿佛、宛如、不禁、一抹、骤然、陡然、蓦然、嘴角、眼神微眯、深吸一口气、意味深长……）——新写的句子同样要过这一遍。
3. 检查自己有没有新造比喻去填补删掉的位置；补情绪要用可听见的物理细节，不要用「跟…似的」。
4. 再自问一遍：这段哪里一眼看起来是 AI 写的？若还有整齐的句长、成套的连接词、拔高的收尾、播音腔对白、同构的段落，再改那一处，然后直接输出最终正文。
不要输出自检过程、草稿、改动清单或说明，只输出最终正文。`

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

export function buildWritingStyleInstruction(
  style: WritingStyleData | null | undefined,
  mode: 'prose' | 'review' = 'prose',
): string {
  if (!style) return mode === 'review' ? '' : HUMAN_VOICE_SYSTEM_RULES

  const parts = [
    `【作者专属写作风格：${style.name}】`,
    mode === 'review'
      ? '用作者文风判断是否存在口吻和节奏偏差，保留作者有意采用的修辞、句段长度与叙述习惯。'
      : '涉及叙述视角、语言、句段节奏和修辞时，以这里的作者设定和样文为准。通用技能、预设和标签中的写法仅在与作者文风相容时使用。遵守本次任务的情节和输出格式要求。',
  ]

  if (style.stylePrompt?.trim()) {
    parts.push(`文风与叙事要求：\n${style.stylePrompt.trim()}`)
  }

  const avoid = (style.avoidPhrases || '').trim()
  if (avoid) parts.push(`作者在此文风中禁用的词语：\n${avoid}`)

  if (style.sampleText?.trim()) {
    const excerpt = style.sampleText.trim().slice(0, 2000)
    parts.push(
      `作者样文参照（参考其句段节奏、对话口吻与用词，勿照搬样文剧情与人名）：\n"""\n${excerpt}\n"""`,
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
