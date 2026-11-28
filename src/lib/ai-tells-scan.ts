/**
 * AI 味体检器（确定性统计，零外部依赖）
 *
 * 存在的理由：去 AI 味的规则要求「只改能举证的问题」，但模型自己看不见句长方差和连接词密度，
 * 只能靠感觉猜。这里用确定性的统计把「哪里像 AI」算出来，作为改写指令的证据，
 * 让改写从盲改变成定点修。
 *
 * 统计维度对应平台侧 AIGC 检测常用的口径（句长波动、连接词密度、短语重复、词汇多样性、
 * 信息密度分布、语义平滑度等），阈值取自公开的实测经验值，属于启发式提示而非判定结论。
 */

import {
  AI_BANNED_PHRASES,
  AI_CAUTION_PHRASES,
  AI_CONNECTIVE_WORDS,
  AI_EMOTION_LABEL_PATTERNS,
  AI_TELL_PATTERNS,
} from '@/lib/ai-tells'
import {
  countOccurrences,
  dialogueCharCount,
  meanOf,
  splitParagraphs,
  splitSentences,
  stdDevOf,
} from '@/lib/ai-tells-text'
import { scanDetails, type DetailStats } from '@/lib/ai-tells-detail-scan'

export type AiScanSeverity = 'high' | 'mid' | 'low'

export interface AiScanFinding {
  /** 对应模式库里的编号 */
  id: string
  label: string
  severity: AiScanSeverity
  /** 统计依据 */
  metric: string
  /** 原句证据 */
  evidence: string[]
  /** 改法 */
  fix: string
}

export interface AiScanStats {
  chars: number
  sentenceCount: number
  paragraphCount: number
  meanSentenceLength: number
  sentenceLengthStdDev: number
  sentenceLengthCv: number
  sentenceLengthRange: number
  connectiveDensity: number
  trigramRepeatRate: number
  paragraphLengthCv: number
  dialogueRatio: number
  dashDensity: number
  bannedHits: number
  cautionHits: number
  emotionLabelHits: number
  /** 专项体检统计：环境 / 说话 / 对白 */
  detail: DetailStats
}

export interface AiScanResult {
  /** 0—100 的启发式风险分，只用于排序，不是判定 */
  riskScore: number
  stats: AiScanStats
  findings: AiScanFinding[]
  /** 一句话摘要 */
  summary: string
}

function trigramStats(text: string): { rate: number; top: Array<{ gram: string; count: number }> } {
  const clean = text.replace(/\s/g, '')
  if (clean.length < 12) return { rate: 0, top: [] }
  const counter = new Map<string, number>()
  let total = 0
  let duplicated = 0
  for (let i = 0; i + 3 <= clean.length; i++) {
    const gram = clean.slice(i, i + 3)
    total++
    const count = (counter.get(gram) || 0) + 1
    counter.set(gram, count)
    if (count > 1) duplicated++
  }
  const top = [...counter.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([gram, count]) => ({ gram, count }))
  return { rate: total ? duplicated / total : 0, top }
}

function sentenceFor(text: string, index: number): string {
  const sentences = splitSentences(text)
  return sentences[index] ?? ''
}

function findSentencesContaining(text: string, needle: string, limit = 3): string[] {
  const sentences = splitSentences(text)
  const hits: string[] = []
  for (const s of sentences) {
    if (s.includes(needle)) {
      hits.push(s.length > 60 ? `${s.slice(0, 60)}…` : s)
      if (hits.length >= limit) break
    }
  }
  return hits
}

/**
 * 对一段正文做 AI 味体检。
 * 文本过短（少于 6 句或 200 字）时只做词层检查，避免短句样本误报统计结论。
 */
export function scanAiTells(text: string): AiScanResult {
  const plain = (text || '').replace(/\s+/g, ' ').trim()
  const chars = plain.replace(/\s/g, '').length
  const sentences = splitSentences(plain)
  const paragraphs = splitParagraphs(text || '')
  const sentenceLengths = sentences.map((s) => s.length)

  const meanSentenceLength = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0
  const sentenceLengthStdDev = stdDevOf(sentenceLengths)
  const sentenceLengthCv = meanSentenceLength ? sentenceLengthStdDev / meanSentenceLength : 0
  const sentenceLengthRange = sentenceLengths.length
    ? Math.max(...sentenceLengths) - Math.min(...sentenceLengths)
    : 0

  const paragraphLengths = paragraphs.map((p) => p.replace(/\s/g, '').length)
  const meanParagraphLength = paragraphLengths.length
    ? paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length
    : 0
  const paragraphLengthCv = meanParagraphLength
    ? stdDevOf(paragraphLengths) / meanParagraphLength
    : 0

  const connectiveCount = AI_CONNECTIVE_WORDS.reduce(
    (acc, word) => acc + countOccurrences(plain, word),
    0,
  )
  const connectiveDensity = chars ? (connectiveCount * 1000) / chars : 0

  const { rate: trigramRepeatRate, top: topTrigrams } = trigramStats(plain)

  const dialogueChars = dialogueCharCount(plain)
  const dialogueRatio = chars ? dialogueChars / chars : 0

  const dashCount = countOccurrences(plain, '——')
  const dashDensity = chars ? (dashCount * 1000) / chars : 0

  const bannedCounts = AI_BANNED_PHRASES.map((p) => ({ phrase: p, count: countOccurrences(plain, p) })).filter(
    (x) => x.count > 0,
  )
  const bannedHits = bannedCounts.reduce((acc, x) => acc + x.count, 0)

  const cautionCounts = AI_CAUTION_PHRASES.map((p) => ({ phrase: p, count: countOccurrences(plain, p) })).filter(
    (x) => x.count > 0,
  )
  const cautionHits = cautionCounts.reduce((acc, x) => acc + x.count, 0)

  const emotionEvidence: string[] = []
  let emotionLabelHits = 0
  for (const re of AI_EMOTION_LABEL_PATTERNS) {
    const globalRe = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = globalRe.exec(plain)) !== null) {
      emotionLabelHits++
      if (emotionEvidence.length < 4) emotionEvidence.push(m[0])
    }
  }

  const findings: AiScanFinding[] = []
  const enoughData = sentences.length >= 6 && chars >= 200

  if (enoughData && sentenceLengthCv < 0.4) {
    findings.push({
      id: 'F1',
      label: '句长过于均匀',
      severity: sentenceLengthCv < 0.3 ? 'high' : 'mid',
      metric: `平均句长 ${meanSentenceLength.toFixed(1)} 字，标准差 ${sentenceLengthStdDev.toFixed(1)}，变异系数 ${sentenceLengthCv.toFixed(2)}（正常应有明显长短落差）`,
      evidence: sentences.slice(0, 3).map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)),
      fix: '在长句后放一个短句，允许一两个字的独立短段；不要把全章改成同一长度。',
    })
  }

  if (enoughData && sentenceLengthRange < 12) {
    findings.push({
      id: 'F1',
      label: '全章句长跨度极窄',
      severity: 'mid',
      metric: `最长句 ${Math.max(...sentenceLengths)} 字，最短句 ${Math.min(...sentenceLengths)} 字，跨度仅 ${sentenceLengthRange} 字`,
      evidence: sentences.slice(0, 2).map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)),
      fix: '打散节奏：补一句短促的判断或动作，长短交替。',
    })
  }

  if (enoughData && connectiveDensity > 8) {
    findings.push({
      id: 'D1',
      label: '连接词成套出现',
      severity: connectiveDensity > 12 ? 'high' : 'mid',
      metric: `每千字 ${connectiveDensity.toFixed(1)} 个过渡连接词（人类写作通常 2—6 个）`,
      evidence: AI_CONNECTIVE_WORDS.filter((w) => plain.includes(w)).slice(0, 4).flatMap((w) => findSentencesContaining(plain, w, 1)),
      fix: '删掉一半连接词，让上下句靠逻辑自然衔接；段落不要以「值得注意的是 / 与此同时」开头。',
    })
  }

  if (enoughData && trigramRepeatRate > 0.18) {
    findings.push({
      id: 'F4',
      label: '短语模板重复',
      severity: trigramRepeatRate > 0.24 ? 'high' : 'mid',
      metric: `三字片段重复率 ${(trigramRepeatRate * 100).toFixed(1)}%，高频：${topTrigrams.map((t) => `${t.gram}×${t.count}`).join('、') || '无'}`,
      evidence: topTrigrams.slice(0, 3).map((t) => findSentencesContaining(plain, t.gram, 1)[0] || t.gram),
      fix: '检查这些重复是不是同一个句式模板；同一模板最多用一次，其余换成动作或对话。',
    })
  }

  if (paragraphs.length >= 4 && paragraphLengthCv < 0.35) {
    findings.push({
      id: 'D2',
      label: '段落长度过于整齐',
      severity: paragraphLengthCv < 0.25 ? 'high' : 'mid',
      metric: `${paragraphs.length} 段，段落长度变异系数 ${paragraphLengthCv.toFixed(2)}`,
      evidence: paragraphs.slice(0, 3).map((p) => (p.length > 40 ? `${p.slice(0, 40)}…` : p)),
      fix: '打乱段落结构：让其中一两段只承担一个动作或一句对白。',
    })
  }

  if (bannedHits >= 3) {
    const top = bannedCounts.sort((a, b) => b.count - a.count).slice(0, 5)
    findings.push({
      id: 'B1',
      label: '高频 AI 套话',
      severity: bannedHits >= 6 ? 'high' : 'mid',
      metric: `命中 ${bannedHits} 处：${top.map((x) => `${x.phrase}×${x.count}`).join('、')}`,
      evidence: top.flatMap((x) => findSentencesContaining(plain, x.phrase, 1)).slice(0, 4),
      fix: '能删就删，能换具体就换具体；换成具体动作、身体反应或现场声响。',
    })
  }

  if (emotionLabelHits >= 2) {
    findings.push({
      id: 'A1',
      label: '情绪直接报账',
      severity: emotionLabelHits >= 4 ? 'high' : 'mid',
      metric: `命中 ${emotionLabelHits} 处直接命名情绪的表达`,
      evidence: emotionEvidence.slice(0, 4),
      fix: '情绪藏进动作、生理反应和现场声响；删掉「心中一紧 / 涌上心头」这类标签。',
    })
  }

  if (dashDensity > 2) {
    findings.push({
      id: 'D2',
      label: '破折号过密',
      severity: dashDensity > 4 ? 'high' : 'mid',
      metric: `每千字 ${dashDensity.toFixed(1)} 处破折号`,
      evidence: findSentencesContaining(plain, '——', 3),
      fix: '全章破折号不超过 2 处，其余改用逗号、分号或直接断开。',
    })
  }

  // 段首模板化：多段用同样的开头
  if (paragraphs.length >= 4) {
    const prefixCount = new Map<string, number>()
    for (const p of paragraphs) {
      // 对白段天然会以「“小师妹」这种称呼起头，不算段首模板
      if (/^[“”「」"]/.test(p)) continue
      const prefix = p.slice(0, 4)
      if (!prefix) continue
      prefixCount.set(prefix, (prefixCount.get(prefix) || 0) + 1)
    }
    const repeated = [...prefixCount.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1])[0]
    if (repeated) {
      findings.push({
        id: 'D1',
        label: '段首模板化',
        severity: 'mid',
        metric: `有 ${repeated[1]} 段以「${repeated[0]}」开头`,
        evidence: paragraphs.filter((p) => p.startsWith(repeated[0])).slice(0, 3).map((p) => (p.length > 40 ? `${p.slice(0, 40)}…` : p)),
        fix: '段首直接从动作、感知或对白切入，不要每段都从同一个位置起手。',
      })
    }
  }

  if (cautionHits >= 4) {
    const top = cautionCounts.sort((a, b) => b.count - a.count).slice(0, 4)
    findings.push({
      id: 'C1',
      label: '拔高与空泛限定待查',
      severity: 'low',
      metric: `命中 ${cautionHits} 处：${top.map((x) => `${x.phrase}×${x.count}`).join('、')}`,
      evidence: top.flatMap((x) => findSentencesContaining(plain, x.phrase, 1)).slice(0, 3),
      fix: '逐处看上下文：属于题材惯用或作者有意保留就留着，属于空泛标签就删掉或换成具体后果。',
    })
  }

  // 合入专项体检：环境描写 / 说话描写 / 对白
  const detail = scanDetails(text || '')
  for (const f of detail.findings) {
    findings.push({
      id: f.id,
      label: f.label,
      severity: f.severity,
      metric: f.metric,
      evidence: f.evidence,
      fix: f.fix,
    })
  }

  const weight: Record<AiScanSeverity, number> = { high: 25, mid: 12, low: 5 }
  const riskScore = Math.min(100, findings.reduce((acc, f) => acc + weight[f.severity], 0))

  const stats: AiScanStats = {
    chars,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    meanSentenceLength: Number(meanSentenceLength.toFixed(1)),
    sentenceLengthStdDev: Number(sentenceLengthStdDev.toFixed(1)),
    sentenceLengthCv: Number(sentenceLengthCv.toFixed(2)),
    sentenceLengthRange,
    connectiveDensity: Number(connectiveDensity.toFixed(1)),
    trigramRepeatRate: Number(trigramRepeatRate.toFixed(3)),
    paragraphLengthCv: Number(paragraphLengthCv.toFixed(2)),
    dialogueRatio: Number(dialogueRatio.toFixed(2)),
    dashDensity: Number(dashDensity.toFixed(1)),
    bannedHits,
    cautionHits,
    emotionLabelHits,
    detail: detail.stats,
  }

  const summary = findings.length
    ? `命中 ${findings.length} 类问题（高 ${findings.filter((f) => f.severity === 'high').length} / 中 ${findings.filter((f) => f.severity === 'mid').length} / 低 ${findings.filter((f) => f.severity === 'low').length}），风险分 ${riskScore}`
    : '未发现明显 AI 味信号，保持原样即可'

  return { riskScore, stats, findings, summary }
}

/** 模式目录：体检命中 id → 完整处方（信号 / 改法 / 不要误伤） */
const PATTERN_PRESCRIPTIONS = new Map<string, AiTellPattern>(
  AI_TELL_PATTERNS.map((p): [string, AiTellPattern] => [p.id, p]),
)

/** 把体检结果渲染成给模型看的证据块 */
export function formatScanForPrompt(result: AiScanResult): string {
  const d = result.stats.detail
  const detailLine = `环境段占比 ${d.envParaRatio}（${d.envParagraphs}/${d.paragraphs}），修饰型提示语占比 ${d.tagModifiedRate}，声音标签句 ${d.voiceQualityCount} 处，对白 ${d.dialogueSentences} 句、句长变异系数 ${d.dialogueSentenceCv}。`
  if (!result.findings.length) {
    return `【机器体检】未发现明显 AI 味信号（句长变异系数 ${result.stats.sentenceLengthCv}，连接词密度 ${result.stats.connectiveDensity}/千字；${detailLine}）。若正文没有可举证的问题，保持原样，不要为了改而改。`
  }

  const lines: string[] = ['【机器体检 · 确定性统计，作为改写依据】']
  lines.push(
    `概览：${result.summary}。句长变异系数 ${result.stats.sentenceLengthCv}（平均句长 ${result.stats.meanSentenceLength} 字），连接词密度 ${result.stats.connectiveDensity}/千字，三字片段重复率 ${(result.stats.trigramRepeatRate * 100).toFixed(1)}%，段落长度变异系数 ${result.stats.paragraphLengthCv}；${detailLine}`,
  )
  lines.push('必须优先处理的位置：')
  for (const f of result.findings) {
    lines.push(`- [${f.severity === 'high' ? '高' : f.severity === 'mid' ? '中' : '低'}] ${f.id} ${f.label}｜依据：${f.metric}｜改法：${f.fix}`)
    const prescription = PATTERN_PRESCRIPTIONS.get(f.id)
    if (prescription) {
      lines.push(
        `  处方：${prescription.signal} → ${prescription.fix}${prescription.guard ? `（不要误伤：${prescription.guard}）` : ''}`,
      )
    }
    if (f.evidence.length) lines.push(`  证据：${f.evidence.join(' / ')}`)
  }
  lines.push('没有被上面点名的段落保持原样；只改能被举证的地方。')
  return lines.join('\n')
}
