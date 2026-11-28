/**
 * AI 味专项体检：环境描写 / 说话描写 / 对白
 *
 * 这三类是上一轮规则没覆盖到的洞：改写时它们往往原封不动。
 * 单独拆出来，是因为它们的病灶与基础体检不同——
 *   环境：模型在填「天气意象 + 情绪投射」的槽位
 *   说话：模型在填「提示语 + 质感修饰」的槽位
 *   对话：模型在填「完整书面句 + 性格标签」的槽位
 *
 * 所有阈值都是启发式门槛，用来排序，不是判定结论。
 */

import {
  cvOf,
  extractQuotes,
  splitParagraphs,
  splitSentences,
  type QuoteSpan,
} from '@/lib/ai-tells-text'

export type DetailSeverity = 'high' | 'mid' | 'low'

export interface DetailFinding {
  id: string
  label: string
  severity: DetailSeverity
  metric: string
  evidence: string[]
  fix: string
}

export interface DetailStats {
  paragraphs: number
  envParagraphs: number
  envParaRatio: number
  taggedCount: number
  tagModifiedRate: number
  voiceQualityCount: number
  dialogueSentences: number
  dialogueSentenceCv: number
}

/* ============================ 环境描写 ============================ */

/** 承载环境的载体词 */
const ENV_CARRIERS = [
  '风', '雪', '雨', '雾', '光', '影', '月', '星', '烟', '尘', '沙', '海', '山', '林', '树',
  '街道', '巷', '房间', '夜', '晨', '昏', '空气', '寒气', '灯火', '阳光', '火光', '晨光', '暮色',
]

/** 把环境接到情绪上的词（只收明确把环境接到情绪上的，别把具体描写误判） */
const ENV_EMOTION_WORDS = [
  '死寂', '沉寂', '压抑得', '令人窒息', '窒息', '令人发寒', '令人不安', '毛骨悚然',
  '不寒而栗', '死气沉沉', '鸦雀无声', '凄冷', '肃杀', '一片死寂',
]

/** 人物动作动词：段落里出现这些就不是纯环境段 */
const ACTION_VERBS = [
  '走', '跑', '站', '坐', '抬', '举', '放', '抓', '握', '递', '推', '拉', '转身', '回头', '伸手',
  '起身', '蹲', '扑', '退', '咳', '喊', '叫', '说', '问', '答', '笑', '皱眉', '点头', '摇头',
  '盯', '看', '拔出', '收起', '松开', '按', '踩', '砸', '扶', '拽', '扑通', '叹', '挣', '爬',
  '撞', '摸', '提', '抱', '踢', '滚', '摔', '掀', '扔', '接', '端', '撕', '拧', '跪', '趴',
  '躺', '靠', '冲', '追', '逃', '躲', '藏', '钻', '挤', '穿', '挂', '摘', '攥', '捂', '挡',
  '拦', '堵', '挥', '伸', '缩', '摸', '擦', '拍', '塞', '踏', '跨', '举', '拽', '甩', '咧',
]

/** 段落里出现人称代词，说明有人的动作，不是纯景物段 */
const PERSON_MARK = /[他她我你您咱俺]/

/** 背景意象：同场景里反复出现的天气/光源词 */
const BACKGROUND_IMAGERY = ['雪', '风', '光', '灯', '灯火', '月', '雨', '雾', '烟']

function isPureEnvironmentParagraph(p: string): boolean {
  if (p.length < 24) return false
  if (/[“”「」"]/.test(p)) return false
  if (PERSON_MARK.test(p)) return false
  if (ACTION_VERBS.some((v) => p.includes(v))) return false
  return splitSentences(p).length >= 2
}

export function scanEnvironment(text: string): DetailFinding[] {
  const findings: DetailFinding[] = []
  const paragraphs = splitParagraphs(text)
  const sentences = splitSentences(text)

  // 1. 无功能的环境段（连续两句以上纯景物，没有人物动作、没有对白）
  const envParas = paragraphs.filter(isPureEnvironmentParagraph)
  const envParaRatio = paragraphs.length ? envParas.length / paragraphs.length : 0
  if (paragraphs.length >= 8 && envParaRatio >= 0.18) {
    findings.push({
      id: 'G1',
      label: '无功能环境段偏多',
      severity: envParaRatio >= 0.3 ? 'high' : 'mid',
      metric: `${paragraphs.length} 段中有 ${envParas.length} 段是纯景物描写（占 ${(envParaRatio * 100).toFixed(0)}%），且段内没有人物动作与对白`,
      evidence: envParas.slice(0, 3).map((p) => (p.length > 44 ? `${p.slice(0, 44)}…` : p)),
      fix: '每段环境必须承担一项：给出行动条件（光、地面、温度、噪音）、出现一个能被人物碰到的物件、或落在人物的生理感受上；三样都不沾就删。',
    })
  }

  // 2. 环境句的情绪落点
  const envSentences = sentences.filter((s) => ENV_CARRIERS.some((c) => s.includes(c)))
  const landingSentences = envSentences.filter((s) => ENV_EMOTION_WORDS.some((w) => s.includes(w)))
  const landingRate = envSentences.length ? landingSentences.length / envSentences.length : 0
  if (envSentences.length >= 6 && landingRate >= 0.12) {
    findings.push({
      id: 'G2',
      label: '环境被接到情绪上',
      severity: landingRate >= 0.25 ? 'high' : 'mid',
      metric: `${envSentences.length} 个环境句里 ${landingSentences.length} 句用「死寂 / 窒息 / 令人发寒」这类词把环境接到情绪上（占 ${(landingRate * 100).toFixed(0)}%）`,
      evidence: landingSentences.slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '环境的落点必须是物理量：删掉「死寂」「沉寂」「令人发寒」「窒息」，改成能被看见、听见、摸到的具体东西。',
    })
  }

  // 3. 背景意象反复（按密度判断，避免单一场景题材误报）
  const chars = text.replace(/\s/g, '').length || 1
  const imagery = BACKGROUND_IMAGERY.map((w) => ({ word: w, count: text.split(w).length - 1 })).sort(
    (a, b) => b.count - a.count,
  )
  const top = imagery[0]
  if (top && top.count >= 8) {
    const density = (top.count * 1000) / chars
    if (density >= 6) {
      findings.push({
        id: 'G3',
        label: '背景意象反复出现',
        severity: 'low',
        metric: `「${top.word}」全章出现 ${top.count} 次（每千字 ${density.toFixed(1)} 次）`,
        evidence: splitSentences(text)
          .filter((s) => s.includes(top.word))
          .slice(0, 3)
          .map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)),
        fix: '同一场景里的天气与背景意象各自最多出现两次，之后改写被它影响的具体东西（肩上的雪化成水、脚印被新雪填平、灯下影子被风吹歪）。',
      })
    }
  }

  // 4. 摆拍静物段：纯环境段里没有任何正在发生的变化
  const DYNAMIC_VERBS = ['移', '滴', '淌', '飘', '卷', '扑', '翻', '涌', '晃', '抖', '烧', '塌', '裂', '滚', '爬', '钻', '响', '颤', '渗', '爬行']
  const frozenParas = envParas.filter((p) => !DYNAMIC_VERBS.some((v) => p.includes(v)))
  if (paragraphs.length >= 8 && frozenParas.length >= 2) {
    findings.push({
      id: 'G5',
      label: '环境摆拍静止',
      severity: 'low',
      metric: `${frozenParas.length} 段纯景物写完就静止（段内只有挂着/铺着/悬着一类的静态陈列，没有正在发生的变化）`,
      evidence: frozenParas.slice(0, 3).map((p) => (p.length > 44 ? `${p.slice(0, 44)}…` : p)),
      fix: '补一个正在发生的变化：光在移、水在滴、影子在走、雪在落；补不了就删短。',
    })
  }

  // 5. 感官单一：长文里完全没有气味/触感词（保守阈值，count===0 才报）
  const NON_VISUAL_SENSES = ['闻到', '嗅到', '气味', '腥', '臭', '焦味', '黏', '烫', '刺痛', '痒']
  const nonVisualCount = NON_VISUAL_SENSES.reduce((acc, w) => acc + (text.split(w).length - 1), 0)
  if (chars >= 2000 && envSentences.length >= 6 && nonVisualCount === 0) {
    findings.push({
      id: 'G6',
      label: '感官单一',
      severity: 'low',
      metric: `全章 ${envSentences.length} 个环境句全部来自视觉/听觉，没有出现任何气味或触感词`,
      evidence: envSentences.slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '安排 1—2 处非视觉感官（土腥味、消毒水味、椅面的凉、把手的黏），落在人物动作上（他闻到焦味才停脚），不硬塞。',
    })
  }

  // 6. 装饰性类比与现成句式
  const decoSimiles = splitSentences(text).filter((s) => /[一-龥]{1,4}般的[一-龥]{1,4}/.test(s))
  const stockOpeners = splitSentences(text).filter((s) =>
    /(风|雪|浪|尘|雾)[卷扑灌涌][着向][^。！？]{0,6}(进|来|去|上|下)/.test(s),
  )
  const decoTotal = decoSimiles.length + stockOpeners.length
  if (decoTotal >= 2) {
    findings.push({
      id: 'G7',
      label: '装饰性类比与句模子',
      severity: decoTotal >= 4 ? 'mid' : 'low',
      metric: `${decoSimiles.length} 处「X般的Y」装饰比喻，${stockOpeners.length} 处「风卷着X灌进Y」式起手`,
      evidence: [...decoSimiles, ...stockOpeners].slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '删掉比喻直接写东西本身；句式换一个起手，或从人物动作切入环境。正样本：光源带出人物（三道提着青铜灯笼的黑影踏雪而来）、物件加动作（裂成两半的青铜灯笼在风里滴溜溜打转）。',
    })
  }

  return findings
}

/* ============================ 说话描写 ============================ */

/** 提示语结尾动词 */
const TAIL_VERB = /(.{0,8}?)(说道|喊道|叹道|问道|答道|应道|应声|开口|嘟囔|咕哝|低语|说|道|问|答|哼|喊|吼|叫|骂|嚷|笑)$/

/** 修饰型提示语的形容词/副词 */
const TAG_MODIFIER = /(冷笑|淡笑|轻笑|苦笑|嘲讽|狞笑|微笑|温柔|低声|沉声|幽幽|哑着|嘶哑|懒洋洋|不耐|戏谑|森然|狠厉|厉声|尖声|脆声|阴恻恻|慢悠悠|漫不经心|淡淡|缓缓|轻轻|微微|平静|无奈|随意|阴阳怪气|皮笑肉不笑|阴阳怪气地)/

/** 提示语里的情绪推断 */
const TAG_INFERENCE = /(似乎|仿佛|好像|似乎觉得|好像觉得|像是|似乎在|忍不住)/

/** 说话人与提示语 */
const GENERIC_SPEAKER = /^(他|她|它|我|你|您|咱|俺|众人|两人|那人|此人|对方|为首|有人|那人|声音|那人|自己|那女人|那男人|这人)/

function parseTag(before: string): { speaker: string; verb: string; prefix: string } | null {
  const cleaned = before.replace(/[，。！？、；：\n\r（）()]/g, ' ').trim()
  const m = cleaned.match(TAIL_VERB)
  if (!m) return null
  const prefix = (m[1] || '').trim()
  const speaker = prefix.replace(/[的地得了着]$/, '')
  return { speaker, verb: m[2], prefix }
}

/**
 * 声音质感判定：只抓「声音被贴上情绪/性格标签」和多余的音量说明，
 * 不抓正常的比喻（"那声音像有人拿指甲在石头刮了一下"是好描写，不能误伤）。
 * 主语词收录：声音/嗓音/嗓子/嗓门/话音/口吻/腔调/语调/语气/笑声/喊声——
 * 「嗓子沙哑」「嗓门压得很低」这类写法同样算声音描写。
 */
const VOICE_SUBJECT = '(?:声音|嗓音|嗓子|嗓门|话音|口吻|腔调|语调|语气|笑声|喊声)'
const VOICE_LABEL = new RegExp(
  `${VOICE_SUBJECT}[^。！？]{0,10}?(${[
    '温润', '嘶哑', '沙哑', '阴柔', '柔和', '冷冽', '婉转', '清冷', '慵懒', '低沉',
    '浑厚', '甜腻', '发颤', '发紧', '阴冷', '冰冷', '狠厉', '凌厉', '幽冷',
  ].join('|')})`,
)
const VOICE_STATE = new RegExp(`${VOICE_SUBJECT}[^。！？]{0,6}?(冷下来|沉下来|软下来|软了|哑了|低下去|变了调|发凉|发冷)`)
const VOICE_TOO = new RegExp(`${VOICE_SUBJECT}[^。！？]{0,6}?(太|很|极|格外|无比)(冷|凉|静|空|闷|柔|硬|沉|哑|淡|狠)[^。！？]{0,3}`)
const VOICE_SCARE =
  new RegExp(`${VOICE_SUBJECT}[^。！？]{0,14}?(令人|让人)[^。！？]{0,6}?(发寒|一凛|发怵|发冷|胆寒|心悸|不寒而栗|头皮发麻)`)
const VOICE_VOLUME = new RegExp(`${VOICE_SUBJECT}[^。！？]{0,5}?(不高|不大|很低|很轻|很沉|刚好够|正好够)[^。！？]{0,10}?(听见|听到|入耳)`)
/** 声音被比作别的东西：要求落在「似的/一样/般」这类比喻收尾上，
 * 否则会把「那声音像有人拿指甲在石头刮了一下」这种正常物理声源误判 */
const VOICE_COMPARE = new RegExp(`${VOICE_SUBJECT}[^。！？]{0,10}?(跟|像)[^。！？]{0,10}?(似的|一样|般)`)

/** 只有这句在描述「说话」时才提示；脑子里的回响、声音的物理来源不算 */
function isVoiceCompareSentence(s: string): boolean {
  if (!VOICE_COMPARE.test(s)) return false
  return /[“”「」"]/.test(s) || /(喊|说|开口|应声|问|答|回话|低语|沉声)/.test(s)
}

function isVoiceQualitySentence(s: string): boolean {
  if (VOICE_STATE.test(s)) return true
  if (VOICE_TOO.test(s)) return true
  if (VOICE_SCARE.test(s)) return true
  if (VOICE_VOLUME.test(s)) return true
  return VOICE_LABEL.test(s)
}

export function scanSpeechTags(text: string): DetailFinding[] {
  const findings: DetailFinding[] = []
  const quotes = extractQuotes(text)
  const paragraphs = splitParagraphs(text)

  // 1. 修饰型提示语比例
  const tagged = quotes.map((q) => ({ quote: q, tag: parseTag(q.before) })).filter((x) => x.tag)
  const modified = tagged.filter(
    (x) => TAG_MODIFIER.test(x.tag!.prefix) || TAG_INFERENCE.test(x.tag!.prefix),
  )
  if (tagged.length >= 5) {
    const rate = modified.length / tagged.length
    if (rate >= 0.3) {
      findings.push({
        id: 'H1',
        label: '修饰型提示语偏多',
        severity: rate >= 0.5 ? 'high' : 'mid',
        metric: `${tagged.length} 条带提示语的对白里 ${modified.length} 条是修饰型（${(rate * 100).toFixed(0)}%）：冷笑道 / 淡淡地说 / 似乎觉得有些好笑`,
        evidence: modified.slice(0, 3).map((x) => `${x.tag!.prefix.replace(/\s/g, '')}${x.tag!.verb}「${x.quote.text.slice(0, 16)}…」`),
        fix: '删掉修饰只留动作或动词：冷笑道→道或换成一个动作；情绪由台词内容承担，不要贴在提示语上。',
      })
    }
  }

  // 2. 声音质感标签（情绪/性格贴在声音上，或多余的音量说明）
  const voiceSentences = splitSentences(text).filter((s) => isVoiceQualitySentence(s))
  const compareSentences = splitSentences(text).filter((s) => isVoiceCompareSentence(s))
  if (voiceSentences.length >= 2) {
    findings.push({
      id: 'H2',
      label: '声音被贴上情绪标签',
      severity: voiceSentences.length >= 4 ? 'high' : 'mid',
      metric: `全章 ${voiceSentences.length} 句把情绪/性格标签贴在声音上，或额外说明音量（声音温润得令人发寒 / 嘶哑得像从喉管深处挤出来 / 声音不高刚好够听见）`,
      evidence: voiceSentences.slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '默认删掉声音标签与音量说明，全章最多留一处且必须是最关键那次；声音由台词本身传达。',
    })
  }
  if (compareSentences.length >= 2) {
    findings.push({
      id: 'H2',
      label: '声音被比喻成人格',
      severity: 'low',
      metric: `全章 ${compareSentences.length} 句用比喻形容声音或语气（声音平得跟冻湖面似的 / 像裹了蜜的刀）`,
      evidence: compareSentences.slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '这类比喻要么去掉，要么换成可听见的物理细节（停顿、吞咽、尾音被截断）；只有比作具体物理声源（脚步、门轴、雨声）时才可保留。',
    })
  }

  // 3. 提示语三层叠加
  const dialogueParas = paragraphs.filter((p) => /[“”「」]/.test(p))
  const stacked = dialogueParas.filter((p) => {
    const before = p.split(/[“”「」]/)[0]
    return before.trim().length > 14 && (TAG_MODIFIER.test(before) || TAG_INFERENCE.test(before))
  })
  if (dialogueParas.length >= 5) {
    const rate = stacked.length / dialogueParas.length
    if (rate >= 0.25) {
      findings.push({
        id: 'H4',
        label: '提示语多层叠加',
        severity: rate >= 0.45 ? 'high' : 'mid',
        metric: `${dialogueParas.length} 个含对白段落中 ${stacked.length} 段的对白前提示语超过 14 字（${(rate * 100).toFixed(0)}%）`,
        evidence: stacked.slice(0, 3).map((p) => {
          const head = p.split(/[“”「」]/)[0].trim()
          return head.length > 46 ? `${head.slice(0, 46)}…` : head
        }),
        fix: '一段对白里提示语最多一层：不要「声音彻底冷下来，他缓缓抬手，指尖夹着三根乌黑的细钉」这样情绪+动作+细节三层堆。',
      })
    }
  }

  return findings
}

/* ============================ 对白 ============================ */

/** 口语语气词：真人会用的标记 */
const COLLOQUIAL_MARKERS = ['呢', '吧', '啊', '嗯', '呀', '嘛', '嘞', '哦', '哎', '喂', '哈', '嘿', '咯', '喽', '哟', '呗', '嘛']

/** 书面语标记：多字词，避免单字误判 */
const FORMAL_TALK = [
  '缓缓', '淡淡', '蓦地', '刹那', '霎时', '须臾', '何以', '何人', '尔等', '吾等', '实乃',
  '诚然', '非但', '更兼', '乃至', '竟也', '莫说', '听我一言', '实不相瞒', '恕我直言', '如此这般',
  '休想', '休要', '区区', '岂能', '安能', '何须', '何必', '既然如此', '这般', '怎的', '也罢',
  '今夜便', '便别再', '就此别过', '好自为之', '敬酒不吃吃罚酒', '识相点', '成全你',
]

/** 台词里的解释性连接 */
const EXPLAIN_TALK = ['也就是说', '换句话说', '你听好了', '我告诉你', '简单来说', '换言之', '意思是', '简单讲']

/** 升华宣言式台词 */
const DECLARATION_TALK = ['从此', '一辈子', '再也', '注定', '命运', '做梦也', '从今往后', '这辈子', '永世', '一生', '躲得了一时', '躲得过初一', '君子报仇', '等着瞧']

function ngrams(text: string, n: number): Set<string> {
  const clean = text.replace(/\s/g, '')
  const set = new Set<string>()
  for (let i = 0; i + n <= clean.length; i++) set.add(clean.slice(i, i + n))
  return set
}

function speakerBuckets(quotes: QuoteSpan[]): Map<string, string[]> {
  const buckets = new Map<string, string[]>()
  for (const q of quotes) {
    const tag = parseTag(q.before)
    if (!tag) continue
    const speaker = tag.speaker.trim()
    if (!speaker || GENERIC_SPEAKER.test(speaker)) continue
    if (!/^[一-龥]{2,4}$/.test(speaker)) continue
    const list = buckets.get(speaker) || []
    list.push(q.text)
    buckets.set(speaker, list)
  }
  return buckets
}

export function scanDialogue(text: string): DetailFinding[] {
  const findings: DetailFinding[] = []
  const quotes = extractQuotes(text)
  const paragraphs = splitParagraphs(text)
  const dialogueSentences: string[] = []
  for (const q of quotes) dialogueSentences.push(...splitSentences(q.text))
  const dialogueLines = dialogueSentences.filter((s) => s.length > 0)
  const dialogueChars = quotes.reduce((acc, q) => acc + q.text.length, 0)

  // 1. 对白句长方差：AI 的对白几乎等长
  const dialogueLengths = dialogueLines.map((s) => s.length)
  if (dialogueLines.length >= 6) {
    const cv = cvOf(dialogueLengths)
    if (cv < 0.4) {
      findings.push({
        id: 'I6',
        label: '对白句长过于整齐',
        severity: cv < 0.3 ? 'high' : 'mid',
        metric: `${dialogueLines.length} 句对白，平均 ${(dialogueLengths.reduce((a, b) => a + b, 0) / dialogueLengths.length).toFixed(1)} 字，变异系数 ${cv.toFixed(2)}（偏低说明每句长度接近）`,
        evidence: dialogueLines.slice(0, 4).map((s) => (s.length > 30 ? `${s.slice(0, 30)}…` : s)),
        fix: '让台词长短拉开：有的只有三个字，有的拖一整句；允许有人只回一个字。',
      })
    }
  }

  // 2. 口语标记率：只有在对白句长也整齐时才报（单独看会误伤冷硬短句风格）
  if (dialogueLines.length >= 12) {
    const colloquial = dialogueLines.filter((s) => COLLOQUIAL_MARKERS.some((m) => s.includes(m)))
    const rate = colloquial.length / dialogueLines.length
    const cv = cvOf(dialogueLengths)
    if (rate < 0.08 && cv < 0.55) {
      findings.push({
        id: 'I5',
        label: '对白缺少口语痕迹且句长整齐',
        severity: 'low',
        metric: `${dialogueLines.length} 句对白里只有 ${colloquial.length} 句带语气词（${(rate * 100).toFixed(0)}%），且对白句长变异系数仅 ${cv.toFixed(2)}`,
        evidence: dialogueLines.slice(0, 4).map((s) => (s.length > 30 ? `${s.slice(0, 30)}…` : s)),
        fix: '让台词长短拉开，并允许语气词与口头停顿：呢、吧、啊、嗯、呀；允许半截话和被打断。',
      })
    }
  }

  // 3. 书面语台词
  if (dialogueLines.length >= 8) {
    const formal = dialogueLines.filter((s) => FORMAL_TALK.some((w) => s.includes(w)))
    const rate = formal.length / dialogueLines.length
    if (rate >= 0.15) {
      findings.push({
        id: 'I1',
        label: '人物说书面语',
        severity: rate >= 0.3 ? 'high' : 'mid',
        metric: `${dialogueLines.length} 句对白里 ${formal.length} 句带书面语标记（${(rate * 100).toFixed(0)}%）`,
        evidence: formal.slice(0, 3).map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)),
        fix: '人物嘴里不要出现书面语词汇与文言腔（缓缓、蓦地、何以、休想）；改成口语。题材本身是修仙宫廷腔的可以保留。',
      })
    }
  }

  // 4. 台词自带解释
  if (dialogueLines.length >= 8) {
    const explain = dialogueLines.filter((s) => EXPLAIN_TALK.some((w) => s.includes(w)))
    const rate = explain.length / dialogueLines.length
    if (rate >= 0.1) {
      findings.push({
        id: 'I2',
        label: '台词在解释',
        severity: rate >= 0.25 ? 'high' : 'mid',
        metric: `${dialogueLines.length} 句对白里 ${explain.length} 句带解释性连接（${(rate * 100).toFixed(0)}%）`,
        evidence: explain.slice(0, 3).map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)),
        fix: '人物不替作者做阅读理解：删掉「也就是说 / 我告诉你 / 换句话说」，让信息由动作、场景或别人的话承担。',
      })
    }
  }

  // 5. 角色用词重合度：对话千人一腔的量化
  const buckets = speakerBuckets(quotes)
  const usable = [...buckets.entries()].filter(([, lines]) => lines.length >= 2 && lines.join('').length >= 40)
  if (usable.length >= 2) {
    let worst = { a: '', b: '', ratio: 0 }
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const setA = ngrams(usable[i][1].join(''), 3)
        const setB = ngrams(usable[j][1].join(''), 3)
        if (!setA.size || !setB.size) continue
        let shared = 0
        for (const g of setA) if (setB.has(g)) shared++
        const ratio = shared / Math.min(setA.size, setB.size)
        if (ratio > worst.ratio) worst = { a: usable[i][0], b: usable[j][0], ratio }
      }
    }
    if (worst.ratio >= 0.3) {
      findings.push({
        id: 'I4',
        label: '不同角色用词高度重合',
        severity: worst.ratio >= 0.45 ? 'high' : 'mid',
        metric: `${worst.a} 与 ${worst.b} 的台词三字片段重合率 ${(worst.ratio * 100).toFixed(0)}%（越高越像同一个人在说话）`,
        evidence: [
          `${worst.a}：${usable.find(([k]) => k === worst.a)?.[1].slice(0, 2).join(' / ') || ''}`,
          `${worst.b}：${usable.find(([k]) => k === worst.b)?.[1].slice(0, 2).join(' / ') || ''}`,
        ],
        fix: '给每个角色固定句长偏好、逻辑方式与口头禅；两人说话必须能只凭文字分辨，不用提示语标签。',
      })
    }
  }

  // 6. 升华宣言式收尾
  const lastQuote = quotes.length ? quotes[quotes.length - 1].text : ''
  if (lastQuote && DECLARATION_TALK.some((w) => lastQuote.includes(w))) {
    findings.push({
      id: 'I3',
      label: '收尾宣言腔',
      severity: 'low',
      metric: `本章最后一句对白含升华词：${lastQuote.slice(0, 40)}`,
      evidence: [lastQuote.slice(0, 60)],
      fix: '角色最后一句用具体动作或具体后果收，不要总结、宣言或预告。',
    })
  }

  // 7. 纯对白无穿插：连续多段只有台词，中间没有任何动作、环境或停顿
  if (paragraphs.length >= 6) {
    let run = 0
    let runStart = -1
    let worst = { len: 0, start: -1 }
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i]
      if (!/[“”「」"]/.test(p)) {
        if (run > worst.len) worst = { len: run, start: runStart }
        run = 0
        runStart = -1
        continue
      }
      // 剥掉引号内台词，看剩下的叙述部分够不够一次动作穿插
      const outside = p
        .replace(/[“”「」"][^“”「」"]*[“”「」"]/g, '')
        .replace(/[“”「」"]/g, '')
        .trim()
      const hasInterleave =
        outside.replace(/\s/g, '').length >= 20 || ACTION_VERBS.some((v) => outside.includes(v))
      if (hasInterleave) {
        if (run > worst.len) worst = { len: run, start: runStart }
        run = 0
        runStart = -1
      } else {
        if (run === 0) runStart = i
        run++
      }
    }
    if (run > worst.len) worst = { len: run, start: runStart }
    if (worst.len >= 5) {
      findings.push({
        id: 'I7',
        label: '纯对白无穿插',
        severity: worst.len >= 8 ? 'high' : 'mid',
        metric: `连续 ${worst.len} 段只有台词，中间没有任何动作、环境或停顿穿插`,
        evidence: paragraphs
          .slice(worst.start, worst.start + 3)
          .map((p) => (p.length > 40 ? `${p.slice(0, 40)}…` : p)),
        fix: '长台词拆成两截，中间插一个动作（他往后撤了半步，灯笼往身前一挡）；或让某人沉默、走神，不要写成话剧剧本。',
      })
    }
  }

  // 8. 书面反派腔与宣言威胁
  // 宣言词必须和威胁动作同句才算，否则「永世不得再入宗门」「抖了一辈子」这类会误报
  const threatLines = dialogueLines.filter(
    (s) =>
      /(便|尔等|吾|汝|岂|焉)[^。！？]{0,8}(别再|休想|休要|不得|莫想|死|杀|埋|刨|烧|毁|除|铲|滚)/.test(s) ||
      /(从今往后|此生|永世|做梦也|再也|绝不|一辈子)[^。！？]{0,16}(死|杀|埋|刨|烧|毁|除|铲|滚|不得好死|不得善终)/.test(s) ||
      /(让你|要你|定要|必要)[^。！？]{0,10}(死|杀|埋|刨|烧|毁|除|铲)/.test(s) ||
      /(不来|不去)[^。！？]{0,12}[，,][^。！？]{0,12}(我|就)/.test(s),
  )
  if (threatLines.length >= 1) {
    findings.push({
      id: 'I8',
      label: '书面反派腔与宣言威胁',
      severity: threatLines.length >= 2 ? 'mid' : 'low',
      metric: `对白里 ${threatLines.length} 句用文言连接或宣言式威胁`,
      evidence: threatLines.slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '改成口语加具体画面（「三年不见，怎么跪得跟条丧家犬似的？」）；威胁只落一件具体的事，最后一句用动作收。',
    })
  }

  if (dialogueChars === 0 && quotes.length === 0) {
    return findings
  }
  return findings
}

/**
 * 哪些模式允许「统计触发」（自动出证据、自动带处方）。
 *
 * 判据：这条模式能不能被文本特征稳定地算出来。
 * 算得出来的（G1/G2/G3/G7、H1/H2/H4、I1~I6、J4 记账）→ 自动触发，给出位置和证据。
 * 算不出来、只能靠语气与语义判断的（G5 摆拍、G6 感官单一、I7 纯对白无穿插、I8 书面反派腔、J1~J3 叙事结构）
 * → 不自动触发，改由规则层让模型逐条自查，否则误报率会高到把好稿改坏。
 */
const AUTO_TRIGGERED_PATTERN_IDS = new Set([
  'G1', 'G2', 'G3', 'G7',
  'H1', 'H2', 'H4',
  'I1', 'I2', 'I3', 'I4', 'I5', 'I6',
  'J4',
])

/* ============================ J. 清单化叙事（记账） ============================ */

/**
 * 记账句判定：一句内出现 3 个以上「数字+量词 / +N / ×N / 积分点数」类数据项，
 * 就是清单化叙事。中文数字（三瓶、两天）不参与统计，避免误伤正常叙述。
 */
export function scanLedger(text: string): DetailFinding[] {
  const findings: DetailFinding[] = []
  const sentences = splitSentences(text)
  const ledgerSentences = sentences.filter((s) => {
    const hits = s.match(
      /(?:[+＋]\s*\d+|×\s*\d+|\d+\s*(?:个|枚|瓶|张|块|条|名|份|级|点|秒|圈)|(?:积分|点数|金币|属性面板|物品清单|收益结算|背包里))/g,
    )
    return !!hits && hits.length >= 3
  })
  if (ledgerSentences.length >= 2) {
    findings.push({
      id: 'J4',
      label: '清单化叙事（记账）',
      severity: ledgerSentences.length >= 4 ? 'mid' : 'low',
      metric: `${ledgerSentences.length} 句呈记账/结算/数据面板形态（单句 3 个以上数据项）`,
      evidence: ledgerSentences.slice(0, 3).map((s) => (s.length > 44 ? `${s.slice(0, 44)}…` : s)),
      fix: '叙事不是记账：只保留对剧情有作用的一两项并给具体细节，其余一句概括或删掉；结算/面板只在题材设定内的真实系统场景允许，且不写成流水账。',
    })
  }
  return findings
}

/** 汇总三类专项体检 */
export function scanDetails(text: string): { findings: DetailFinding[]; stats: DetailStats } {
  const paragraphs = splitParagraphs(text)
  const quotes = extractQuotes(text)
  const envParas = paragraphs.filter(isPureEnvironmentParagraph)

  const tagged = quotes.map((q) => ({ quote: q, tag: parseTag(q.before) })).filter((x) => x.tag)
  const modified = tagged.filter(
    (x) => TAG_MODIFIER.test(x.tag!.prefix) || TAG_INFERENCE.test(x.tag!.prefix),
  )

  const dialogueSentences: string[] = []
  for (const q of quotes) dialogueSentences.push(...splitSentences(q.text))
  const lengths = dialogueSentences.filter((s) => s.length > 0).map((s) => s.length)

  const stats: DetailStats = {
    paragraphs: paragraphs.length,
    envParagraphs: envParas.length,
    envParaRatio: paragraphs.length ? Number((envParas.length / paragraphs.length).toFixed(2)) : 0,
    taggedCount: tagged.length,
    tagModifiedRate: tagged.length ? Number((modified.length / tagged.length).toFixed(2)) : 0,
    voiceQualityCount: splitSentences(text).filter((s) => isVoiceQualitySentence(s)).length,
    dialogueSentences: lengths.length,
    dialogueSentenceCv: Number(cvOf(lengths).toFixed(2)),
  }

  return {
    findings: [
      ...scanEnvironment(text),
      ...scanSpeechTags(text),
      ...scanDialogue(text),
      ...scanLedger(text),
    ].filter((f) => AUTO_TRIGGERED_PATTERN_IDS.has(f.id)),
    stats,
  }
}
