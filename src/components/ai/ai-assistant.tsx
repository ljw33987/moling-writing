'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Send,
  Sparkles,
  Loader2,
  Wand2,
  BookMarked,
  Trash2,
  Bot,
  User as UserIcon,
  Lightbulb,
  AtSign,
  FileText,
  BookText,
  Users,
  Globe,
  Gem,
  X,
  Cpu,
  Copy,
  Check,
  List,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import { PLATFORM_MODEL_ALIASES, type PublicAiModel } from '@/lib/ai-models'
import type { AiReferenceOption } from '@/app/api/ai/references/route'
import { MarkdownRenderer, markdownToPlainText } from './markdown-renderer'

interface Preset {
  id: string
  name: string
  category: string
  description: string
  system: string
}

interface ReferencedItem {
  type: AiReferenceOption['type']
  id: string
  title: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  preset?: string
  modelLabel?: string
  references?: ReferencedItem[]
  isError?: boolean
}

interface Props {
  novelId: string
  chapterId: string | null
  onInsertText: (text: string) => void
}

const REF_TYPE_META: Record<
  AiReferenceOption['type'],
  { label: string; icon: typeof FileText; chipClass: string }
> = {
  chapter: {
    label: '章节',
    icon: FileText,
    chipClass: 'bg-primary/10 text-primary border-primary/20',
  },
  outline: {
    label: '大纲',
    icon: BookText,
    chipClass: 'bg-gold/10 text-gold border-gold/20',
  },
  character: {
    label: '角色',
    icon: Users,
    chipClass: 'bg-jade/10 text-jade border-jade/20',
  },
  worldview: {
    label: '世界观',
    icon: Globe,
    chipClass: 'bg-primary/10 text-primary border-primary/20',
  },
  item: {
    label: '道具',
    icon: Gem,
    chipClass: 'bg-cinnabar/10 text-cinnabar border-cinnabar/20',
  },
}

export function AiAssistant({ novelId, chapterId, onInsertText }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetOpen, setPresetOpen] = useState(false)

  // 模型选择（仅展示自定义脱敏名称，如 moling_v4 / moling_v4_pro）
  const [models, setModels] = useState<PublicAiModel[]>(PLATFORM_MODEL_ALIASES)
  const [selectedModel, setSelectedModel] = useState<string>('moling_v4')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  // @ 多文件引用状态
  const [availableRefs, setAvailableRefs] = useState<AiReferenceOption[]>([])
  const [referencedItems, setReferencedItems] = useState<ReferencedItem[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionTriggerType, setMentionTriggerType] = useState<'at' | 'button'>('button')

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastRequestRef = useRef<{ text: string; preset?: string; refs?: ReferencedItem[] } | null>(null)

  useEffect(() => {
    api<{ presets: Preset[] }>('/api/ai')
      .then((r) => setPresets(r.presets))
      .catch(() => {})

    api<{ models: PublicAiModel[] }>('/api/ai/models')
      .then((r) => {
        if (r.models?.length) {
          setModels(r.models)
        }
      })
      .catch(() => {})
  }, [])

  const loadReferences = useCallback(() => {
    if (!novelId) return
    api<{ references: AiReferenceOption[] }>(`/api/ai/references?novelId=${novelId}`)
      .then((r) => setAvailableRefs(r.references || []))
      .catch(() => {})
  }, [novelId])

  useEffect(() => {
    loadReferences()
  }, [loadReferences])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const filteredRefs = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    const list = q
      ? availableRefs.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            (r.subtitle && r.subtitle.toLowerCase().includes(q)) ||
            REF_TYPE_META[r.type].label.includes(q)
        )
      : availableRefs
    return list.slice(0, 30)
  }, [availableRefs, mentionQuery])

  const addReference = (item: AiReferenceOption) => {
    setReferencedItems((prev) => {
      if (prev.some((p) => p.type === item.type && p.id === item.id)) return prev
      return [...prev, { type: item.type, id: item.id, title: item.title }]
    })

    // 如果是通过输入 @xxx 触发的，清理末尾的 @query
    if (mentionTriggerType === 'at' && textareaRef.current) {
      const el = textareaRef.current
      const cursor = el.selectionStart ?? input.length
      const before = input.slice(0, cursor)
      const after = input.slice(cursor)
      const match = before.match(/@([^\s@]*)$/)
      if (match) {
        const nextBefore = before.slice(0, before.length - match[0].length)
        setInput(nextBefore + after)
      }
    }

    setMentionOpen(false)
    setMentionQuery('')
    setMentionIndex(0)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const removeReference = (type: AiReferenceOption['type'], id: string) => {
    setReferencedItems((prev) => prev.filter((p) => !(p.type === type && p.id === id)))
  }

  const handleInputChange = (val: string) => {
    setInput(val)
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? val.length
    const before = val.slice(0, cursor)
    const match = before.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setMentionTriggerType('at')
      setMentionQuery(match[1] || '')
      setMentionIndex(0)
      if (!mentionOpen) {
        loadReferences()
        setMentionOpen(true)
      }
    } else if (mentionOpen && mentionTriggerType === 'at') {
      setMentionOpen(false)
    }
  }

  const sendMessage = async (
    content: string,
    preset?: string,
    overrideRefs?: ReferencedItem[]
  ) => {
    if (!content.trim() || loading) return
    const refsToUse = overrideRefs ?? referencedItems
    lastRequestRef.current = { text: content, preset, refs: refsToUse }
    const currentModelObj = models.find((m) => m.id === selectedModel)
    const userMsg: Message = {
      role: 'user',
      content,
      preset,
      modelLabel: currentModelObj?.label || selectedModel,
      references: refsToUse.length > 0 ? [...refsToUse] : undefined,
    }
    setMessages((prev) => [...prev, userMsg])
    if (!overrideRefs) {
      setInput('')
      setReferencedItems([])
    }
    setMentionOpen(false)
    setLoading(true)

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        preset,
        modelLabel: currentModelObj?.label || selectedModel,
      },
    ])

    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'chat',
          preset: preset || undefined,
          message: content,
          novelId,
          chapterId,
          modelId: selectedModel,
          referencedItems: refsToUse,
        }),
      })

      if (res.status === 401) {
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: '登录已过期，请重新登录后继续使用 AI。',
          }
          return copy
        })
        return
      }
      if (res.status === 402) {
        const err = await res.json().catch(() => ({}))
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: err.error || 'Token 余额不足，请前往用户中心充值。',
          }
          return copy
        })
        return
      }
      if (!res.ok || !res.body) {
        throw new Error('AI 调用失败')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let lastUpdateTime = 0
      const UPDATE_INTERVAL = 50

      const updateUI = (force = false) => {
        const now = Date.now()
        if (force || now - lastUpdateTime >= UPDATE_INTERVAL) {
          lastUpdateTime = now
          setMessages((prev) => {
            const copy = [...prev]
            copy[copy.length - 1] = {
              role: 'assistant',
              content: fullContent,
              preset,
              modelLabel: currentModelObj?.label || selectedModel,
            }
            return copy
          })
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (!data) continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.delta) {
                fullContent += parsed.delta
                updateUI()
              }
              if (parsed.error) {
                setMessages((prev) => {
                  const copy = [...prev]
                  copy[copy.length - 1] = {
                    role: 'assistant',
                    content: `出错了：${parsed.error}`,
                    isError: true,
                  }
                  return copy
                })
              }
            } catch {}
          }
        }
      }

      updateUI(true)
    } catch (e: any) {
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant' && !last.content) {
          copy[copy.length - 1] = {
            role: 'assistant',
            content: `抱歉，生成失败：${e.message || '网络异常，请重试'}`,
            isError: true,
          }
        } else {
          copy.push({
            role: 'assistant',
            content: `抱歉，生成失败：${e.message || '网络异常，请重试'}`,
            isError: true,
          })
        }
        return copy
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSend = () => {
    sendMessage(input)
  }

  const handleRegenerate = (msgIndex: number) => {
    if (loading) return
    // 找到该条助手消息对应的上一条用户消息
    let userContent = ''
    let userRefs: ReferencedItem[] | undefined
    let userMsgIndex = -1
    for (let k = msgIndex - 1; k >= 0; k--) {
      if (messages[k]?.role === 'user') {
        userContent = messages[k].content
        userRefs = messages[k].references
        userMsgIndex = k
        break
      }
    }
    const presetToUse = messages[msgIndex]?.preset || lastRequestRef.current?.preset
    const textToUse = userContent || lastRequestRef.current?.text || ''
    const refsToUse = userRefs || lastRequestRef.current?.refs
    if (!textToUse.trim()) return

    if (userMsgIndex >= 0) {
      setMessages((prev) => prev.slice(0, userMsgIndex))
    }
    void sendMessage(textToUse, presetToUse, refsToUse)
  }

  const handlePreset = (p: Preset) => {
    setPresetOpen(false)
    if (p.id === 'poison_check' || p.id === 'break_block') {
      sendMessage(`请基于当前章节及引用的内容，执行「${p.name}」任务。`, p.id)
    } else if (p.id === 'name_gen') {
      sendMessage('请生成 10 个有特色的招式名，附带风格说明。', p.id)
    } else if (p.id === 'golden_three') {
      sendMessage('请基于当前小说设定，生成抓人的前三章。', p.id)
    } else if (p.id === 'char_dialogue') {
      sendMessage('请模拟当前小说中两个核心角色的对话，5-8 轮。', p.id)
    } else {
      const content = prompt(`使用「${p.name}」预设，请输入内容：`, '')
      if (content) sendMessage(content, p.id)
    }
  }

  const handleClear = () => {
    setMessages([])
  }

  const grouped = presets.reduce<Record<string, Preset[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  return (
    <div className="h-full min-h-0 flex flex-col bg-card overflow-hidden border-l border-border">
      {/* 顶部（靛紫渐变球 + @多文件分析副标题） */}
      <div className="border-b border-border flex items-center px-3.5 py-2.5 gap-2.5 shrink-0 bg-card">
        <div className="w-8 h-8 rounded-[10px] ai-brand-mark flex items-center justify-center shrink-0 text-white">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13.5px] leading-tight truncate">写作 AI 助手</div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            @多文件分析 · 已注入世界观/大纲/前情
          </div>
        </div>
        <Popover open={presetOpen} onOpenChange={setPresetOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-[7px]" title="预设指令库">
              <List className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                预设指令库
              </div>
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className="text-xs text-muted-foreground mb-1">{cat}</div>
                  <div className="space-y-1">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handlePreset(p)}
                        className="w-full text-left px-2 py-1.5 hover:bg-muted rounded text-sm flex flex-col"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-[7px] text-muted-foreground hover:text-cinnabar" onClick={handleClear} title="清空对话">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* 对话区：严格限制在面板内部滚动 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3"
      >
        {messages.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center px-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gold/25 to-gold/10 flex items-center justify-center mb-3">
              <Wand2 className="w-5 h-5 text-gold" />
            </div>
            <p className="text-sm font-medium mb-1">写作 AI 助手已就绪</p>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              输入 <span className="font-mono font-medium text-foreground">@</span> 引用章节、大纲或设定，让 AI 进行深度分析与解读
            </p>
            <div className="space-y-1.5 w-full">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Lightbulb className="w-3 h-3" /> 试试：
              </p>
              {[
                '帮我分析当前章节的剧情节奏与爽点',
                '帮我把这一章的结尾改得更有悬念',
                '检查当前剧情和角色设定是否有逻辑冲突',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="w-full text-left text-xs px-3 py-2 bg-muted/50 hover:bg-muted rounded border border-border transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'assistant' && !m.content && loading) return null
          return (
            <div
              key={i}
              className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-7 h-7 rounded-[9px] shrink-0 flex items-center justify-center ${
                  m.role === 'user'
                    ? 'bg-[var(--surface-3)] text-foreground'
                    : 'ai-brand-mark text-white'
                }`}
              >
                {m.role === 'user' ? (
                  <UserIcon className="w-3.5 h-3.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
              </div>
              <div className={`flex-1 min-w-0 max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
                <div className={`flex items-center gap-1.5 mb-1 flex-wrap ${m.role === 'user' ? 'justify-end' : ''}`}>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {m.role === 'user' ? '我' : 'AI 助手'}
                  </span>
                  {m.role === 'assistant' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[var(--violet)]/30 bg-[var(--violet-soft)] text-[var(--violet)]">
                      长文记忆
                    </Badge>
                  )}
                  {m.preset && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {presets.find((p) => p.id === m.preset)?.name || m.preset}
                    </Badge>
                  )}
                  {m.role === 'assistant' && m.modelLabel && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                      {m.modelLabel}
                    </Badge>
                  )}
                </div>
                {m.references && m.references.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mb-1.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {m.references.map((ref) => {
                      const meta = REF_TYPE_META[ref.type]
                      const Icon = meta.icon
                      return (
                        <span
                          key={`${ref.type}-${ref.id}`}
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${meta.chipClass}`}
                        >
                          <Icon className="w-2.5 h-2.5" />
                          <span className="truncate max-w-[120px]">{ref.title}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
                {m.role === 'user' ? (
                  <div className="inline-block text-[13px] px-3 py-2 rounded-[10px] whitespace-pre-wrap break-words text-left max-w-full bg-[var(--surface-3)] text-foreground border border-border">
                    {m.content}
                  </div>
                ) : (
                  <div className="inline-block px-3.5 py-2.5 rounded-[12px] text-left max-w-full bg-card border border-border border-l-2 border-l-[var(--violet)] shadow-xs overflow-hidden">
                    <MarkdownRenderer content={m.content} />
                  </div>
                )}
                {m.role === 'assistant' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {!m.isError && (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                          onClick={() => onInsertText(markdownToPlainText(m.content))}
                        >
                          <Send className="w-3 h-3" />
                          插入到正文
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                          onClick={() => {
                            navigator.clipboard.writeText(markdownToPlainText(m.content))
                            setCopiedIndex(i)
                            toast.success('已复制纯文本')
                            setTimeout(() => setCopiedIndex(null), 1500)
                          }}
                        >
                          {copiedIndex === i ? <Check className="w-3 h-3 text-jade" /> : <Copy className="w-3 h-3" />}
                          复制
                        </Button>
                      </>
                    )}
                    <Button
                      variant={m.isError ? 'default' : 'ghost'}
                      size="sm"
                      disabled={loading}
                      className="h-6 px-2.5 text-[11px] gap-1 rounded-[7px]"
                      onClick={() => handleRegenerate(i)}
                      title="重新生成"
                    >
                      <RefreshCw className="w-3 h-3" />
                      {m.isError ? '刷新重试' : '重新生成'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {loading && !messages.some((m) => m.role === 'assistant' && m.content) && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold/25 to-gold/10 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-gold" />
            </div>
            <div className="bg-gold/10 border border-gold/25 rounded-lg px-3 py-2 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-gold" />
              <span className="text-sm text-muted-foreground">思考中</span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区（含 @ 引用浮层、已选文件标签、模型选择器） */}
      <div className="p-3 border-t border-border shrink-0 relative bg-card/50">
        {/* @ 文件引用浮层 */}
        {mentionOpen && (
          <div className="absolute left-3 right-3 bottom-full mb-1.5 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between bg-muted/40">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <AtSign className="w-3.5 h-3.5 text-primary" />
                选择要引用的文件或设定（支持多选）
              </span>
              <button
                type="button"
                onClick={() => setMentionOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
              {filteredRefs.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  未找到匹配的章节或设定
                </div>
              ) : (
                filteredRefs.map((item, idx) => {
                  const meta = REF_TYPE_META[item.type]
                  const Icon = meta.icon
                  const alreadyAdded = referencedItems.some(
                    (r) => r.type === item.type && r.id === item.id
                  )
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      onClick={() => addReference(item)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition ${
                        idx === mentionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                        {alreadyAdded ? '已引用' : meta.label}
                      </Badge>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* 已 @ 引用的文件标签 + 添加引用按钮 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 max-h-20 overflow-y-auto">
          {referencedItems.map((ref) => {
            const meta = REF_TYPE_META[ref.type]
            const Icon = meta.icon
            return (
              <span
                key={`${ref.type}-${ref.id}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[7px] border border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand-ink)]"
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[130px]">{ref.title}</span>
                <button
                  type="button"
                  onClick={() => removeReference(ref.type, ref.id)}
                  className="hover:opacity-70 ml-0.5"
                  title="移除引用"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setMentionTriggerType('button')
              setMentionQuery('')
              setMentionIndex(0)
              loadReferences()
              setMentionOpen((v) => !v)
            }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[7px] border border-border bg-card hover:bg-[var(--surface-3)] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" />
            引用设定
          </button>
        </div>

        {/* 一体化 AI 输入框 */}
        <div className="rounded-[12px] border border-[var(--line-2)] bg-[var(--surface-2)] focus-within:border-primary focus-within:bg-card transition-colors p-2.5">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="输入问题，或输入 @ 引用多个章节/设定进行分析..."
            rows={2}
            className="resize-none text-[13px] min-h-[44px] max-h-28 border-0 bg-transparent p-0 focus-visible:ring-0 shadow-none"
            onKeyDown={(e) => {
              if (mentionOpen && filteredRefs.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMentionIndex((prev) => (prev + 1) % filteredRefs.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex((prev) => (prev - 1 + filteredRefs.length) % filteredRefs.length)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const target = filteredRefs[mentionIndex]
                  if (target) addReference(target)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMentionOpen(false)
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />

          <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-border/60">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger className="h-6 w-auto min-w-[110px] max-w-[160px] text-[11px] px-2 gap-1 border-0 bg-transparent shadow-none hover:bg-[var(--surface-3)] rounded-[6px]">
                      <Sparkles className="w-3 h-3 text-primary shrink-0" />
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">
                          <div className="flex flex-col gap-0.5 py-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-medium">{m.label}</span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {m.badge}
                              </Badge>
                            </div>
                            {m.description && (
                              <span className="text-[10px] text-muted-foreground">{m.description}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-xs text-xs space-y-1 p-2.5 bg-popover text-popover-foreground border border-border shadow-lg">
                {models.map((m) => (
                  <div key={m.id}>
                    <span className="font-mono font-semibold">{m.label}</span>：{m.description}
                  </div>
                ))}
              </TooltipContent>
            </Tooltip>

            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="ml-auto w-7 h-7 rounded-[8px] ai-brand-mark text-white inline-flex items-center justify-center disabled:opacity-45 hover:opacity-95 transition-opacity shrink-0"
              title="发送"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* 底部快捷分析标签 */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[
            { label: '深度解读分析', prompt: '请深度解读并分析当前章节及关联材料的核心剧情与亮点' },
            { label: '对比检查逻辑漏洞', prompt: '请对比检查当前章节与已有设定中的逻辑漏洞与人设冲突' },
          ].map((quick) => (
            <button
              key={quick.label}
              type="button"
              disabled={loading}
              onClick={() => sendMessage(quick.prompt, undefined, referencedItems)}
              className="text-[11px] px-2.5 py-1 rounded-[7px] border border-border bg-card hover:bg-[var(--surface-3)] text-muted-foreground hover:text-foreground transition-colors"
            >
              {quick.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
