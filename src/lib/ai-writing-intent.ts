const readOnlyRequest = /审稿|审校|审读|校对|点评|评分|评估|分析|解读|诊断|查错|找错|核对|检查|逻辑漏洞|一致性|只读|不要改|不要续写|不续写|不改写|不写入|\b(?:review|audit|analy[sz]e|critique|proofread)\b/i
const proseRequest = /写一|写第|帮我写|生成.{0,8}(正文|章节|前三章|开篇)|续写|扩写|改写|重写|润色|缩写|去AI味|改得|对白|对话|\b(?:rewrite|continue|draft|revise)\b/i

export function allowsAiProseWriteback(message: string, preset?: string): boolean {
  if (preset === 'poison_check' || readOnlyRequest.test(message)) return false
  return preset === 'golden_three' || preset === 'char_dialogue' || proseRequest.test(message)
}
