/**
 * AI 味体检的共享文本工具
 *
 * 单独抽出来给「基础体检」和「描写 / 说话 / 对白专项体检」共用，避免两份实现算出不一样的结果。
 */

/** 句子切分：按中文句末标点断句，保留引号内内容 */
export function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?…]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 段落切分 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    count++
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

export function meanOf(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function stdDevOf(values: number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** 变异系数：离散程度，AI 文本偏低 */
export function cvOf(values: number[]): number {
  const mean = meanOf(values)
  return mean ? stdDevOf(values) / mean : 0
}

export interface QuoteSpan {
  /** 引号内文本 */
  text: string
  /** 引号前 18 字（用于识别提示语与说话人） */
  before: string
  /** 引号后 18 字 */
  after: string
  start: number
  end: number
}

const QUOTE_PATTERNS = [/“([^”]*)”/g, /「([^」]*)」/g, /"([^"]*)"/g]

/** 提取所有对白片段及其上下文 */
export function extractQuotes(text: string): QuoteSpan[] {
  const spans: QuoteSpan[] = []
  for (const re of QUOTE_PATTERNS) {
    const global = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = global.exec(text)) !== null) {
      spans.push({
        text: m[1],
        before: text.slice(Math.max(0, m.index - 18), m.index),
        after: text.slice(m.index + m[0].length, m.index + m[0].length + 18),
        start: m.index,
        end: m.index + m[0].length,
      })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

/** 对话总字数（引号内字符数） */
export function dialogueCharCount(text: string): number {
  return extractQuotes(text).reduce((acc, q) => acc + q.text.length, 0)
}
