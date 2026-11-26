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
    chipClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  outline: {
    label: '大纲',
    icon: BookText,
    chipClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  character: {
    label: '角色',
    icon: Users,
    chipClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  worldview: {
    label: '世界观',
    icon: Globe,
    chipClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  },
  item: {
    label: '道具',
    icon: Gem,
    chipClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
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
            content: `抱歉，出错了：${e.message}`,
          }
        } else {
          copy.push({ role: 'assistant', content: `抱歉，出错了：${e.message}` })
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
    <div className="h-full min-h-0 flex flex-col bg-card/30 overflow-hidden">
      {/* 顶部 */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <Bot className="w-4 h-4 text-teal-" />
        <span className="font-medium text-sm truncate">写作 AI 助手</span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
          @多文件分析
        </Badge>
        <Popover open={presetOpen} onOpenChange={setPresetOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto shrink-0" title="预设指令库">
              <BookMarked className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-" />
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
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleClear} title="清空对话">
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
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-600/20 to-blue-600/20 flex items-center justify-center mb-3">
              <Wand2 className="w-5 h-5 text-teal-" />
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
                className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${
                  m.role === 'user'
                    ? 'bg-emerald-500/20'
                    : 'bg-gradient-to-br from-indigo-600/20 to-blue-600/20'
                }`}
              >
                {m.role === 'user' ? (
                  <UserIcon className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-teal-" />
                )}
              </div>
              <div className={`flex-1 min-w-0 max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
                <div className={`flex items-center gap-1 mb-1 flex-wrap ${m.role === 'user' ? 'justify-end' : ''}`}>
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
                  <div className="inline-block text-sm px-3 py-2 rounded-lg whitespace-pre-wrap break-words text-left max-w-full bg-emerald-500/15 text-emerald-900 dark:text-emerald-100">
                    {m.content}
                  </div>
                ) : (
                  <div className="inline-block px-3.5 py-2.5 rounded-lg text-left max-w-full bg-muted/70 border border-border/50 overflow-hidden">
                    <MarkdownRenderer content={m.content} />
                  </div>
                )}
                {m.role === 'assistant' && (
                  <div className="mt-1 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => onInsertText(markdownToPlainText(m.content))}
                    >
                      <Send className="w-3 h-3" />
                      插入到正文
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => {
                        navigator.clipboard.writeText(markdownToPlainText(m.content))
                        setCopiedIndex(i)
                        toast.success('已复制纯文本')
                        setTimeout(() => setCopiedIndex(null), 1500)
                      }}
                    >
                      {copiedIndex === i ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      复制
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {loading && !messages.some((m) => m.role === 'assistant' && m.content) && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600/20 to-blue-600/20 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-teal-" />
            </div>
            <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
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

        {/* 已 @ 引用的文件标签栏 */}
        {referencedItems.length > 0 && (
          <div className="mb-2 space-y-1.5">
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {referencedItems.map((ref) => {
                const meta = REF_TYPE_META[ref.type]
                const Icon = meta.icon
                return (
                  <span
                    key={`${ref.type}-${ref.id}`}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${meta.chipClass}`}
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="truncate max-w-[140px]">{ref.title}</span>
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
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                '请深度解读并分析这些材料的核心剧情与亮点',
                '请对比检查这些材料中的逻辑漏洞与人设冲突',
              ].map((quickPrompt) => (
                <button
                  key={quickPrompt}
                  type="button"
                  disabled={loading}
                  onClick={() => sendMessage(quickPrompt, undefined, referencedItems)}
                  className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition"
                >
                  ✨ {quickPrompt.slice(1, 14)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 文本输入框 */}
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="输入问题，或输入 @ 引用多个章节/设定进行分析... (Shift+Enter 换行)"
            rows={2}
            className="resize-none text-sm min-h-[56px] max-h-28"
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
          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            size="icon"
            className="h-9 w-9 shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>

        {/* 底部工具栏：@引用按钮 + 自定义模型选择 */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => {
              setMentionTriggerType('button')
              setMentionQuery('')
              setMentionIndex(0)
              loadReferences()
              setMentionOpen((v) => !v)
            }}
          >
            <AtSign className="w-3.5 h-3.5" />
            引用文件
            {referencedItems.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                {referencedItems.length}
              </Badge>
            )}
          </Button>

          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="h-7 w-auto min-w-[130px] max-w-[180px] text-xs px-2 gap-1.5">
              <Cpu className="w-3 h-3 text-muted-foreground shrink-0" />
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent align="end">
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-medium">{m.label}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {m.badge}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
