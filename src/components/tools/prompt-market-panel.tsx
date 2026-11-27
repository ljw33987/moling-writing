'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Heart, Copy, Sparkles, Plus, Flame, Loader2, Layers } from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import {
  getSavedPrompts,
  removeSavedPrompt,
  savePromptToLibrary,
  SAVED_PROMPTS_EVENT,
} from '@/lib/saved-prompts'
import { PROMPT_CATEGORIES } from '@/lib/prompt-categories'

const CATEGORIES = ['全部', ...PROMPT_CATEGORIES]

export interface AppliedPromptMeta {
  id: string
  title: string
  category: string
}

interface PromptItem {
  id: string
  title: string
  category: string
  description: string
  promptText: string
  authorName: string
  useCount: number
  likesCount: number
  isOfficial: boolean
}

interface Props {
  onApplyPrompt: (promptText: string, meta: AppliedPromptMeta) => void
}

export function PromptMarketPanel({ onApplyPrompt }: Props) {
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)

  // 发布弹窗
  const [publishOpen, setPublishOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [pubCategory, setPubCategory] = useState('大纲模板')
  const [description, setDescription] = useState('')
  const [promptText, setPromptText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [detailItem, setDetailItem] = useState<PromptItem | null>(null)

  useEffect(() => {
    const sync = () => setSavedIds(getSavedPrompts().map((p) => p.id))
    sync()
    window.addEventListener(SAVED_PROMPTS_EVENT, sync)
    return () => window.removeEventListener(SAVED_PROMPTS_EVENT, sync)
  }, [])

  const loadPrompts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (category !== '全部') params.set('category', category)
      if (query.trim()) params.set('q', query.trim())
      const r = await api<{ items: PromptItem[] }>(`/api/prompts?${params.toString()}`)
      setItems(r.items || [])
    } catch (e: any) {
      toast.error(e.message || '加载模板市场失败')
    } finally {
      setLoading(false)
    }
  }, [category, query])

  useEffect(() => {
    const t = setTimeout(() => void loadPrompts(), 150)
    return () => clearTimeout(t)
  }, [loadPrompts])

  const handleLike = async (id: string) => {
    try {
      const r = await api<{ item: PromptItem }>('/api/prompts', {
        method: 'PATCH',
        body: JSON.stringify({ id, action: 'like' }),
      })
      setItems((prev) => prev.map((it) => (it.id === id ? r.item : it)))
    } catch {}
  }

  const handleToggleSave = async (item: PromptItem) => {
    const isSaved = savedIds.includes(item.id)
    if (isSaved) {
      removeSavedPrompt(item.id)
      toast.success(`已从设定库取消「${item.title}」`)
      return
    }
    api('/api/prompts', {
      method: 'PATCH',
      body: JSON.stringify({ id: item.id, action: 'use' }),
    }).catch(() => {})
    savePromptToLibrary({
      id: item.id,
      title: item.title,
      category: item.category,
      description: item.description,
      promptText: item.promptText,
    })
    toast.success(`已套用到我的设定库「${item.title}」（可在写作 AI 助手中直接调用）`)
  }

  const handlePublish = async () => {
    if (!title.trim() || !description.trim() || !promptText.trim()) {
      toast.error('请填写完整标题、适用场景和提示词指令')
      return
    }
    setSubmitting(true)
    try {
      await api('/api/prompts', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category: pubCategory,
          description,
          promptText,
        }),
      })
      toast.success('已发布到提示词模板市场！')
      setPublishOpen(false)
      setTitle('')
      setDescription('')
      setPromptText('')
      void loadPrompts()
    } catch (e: any) {
      toast.error(e.message || '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* 筛选栏 + 发布按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant={category === cat ? 'default' : 'outline'}
              className={`h-7 text-xs rounded-full ${
                category === cat ? 'bg-primary shadow-sm' : ''
              }`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模板或作者..."
              className="pl-8 h-8 text-xs"
            />
          </div>

          <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="h-8 gap-1 text-xs bg-primary hover:bg-primary/90 rounded-full shadow-sm shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                发布模板
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>发布提示词 / 创作模板</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">模板标题 *</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例：高燃退婚流打脸模板"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">分类</Label>
                  <Select value={pubCategory} onValueChange={setPubCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter((c) => c !== '全部').map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">适用场景说明 *</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="简述适合什么题材或写作卡点"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">提示词指令内容 *</Label>
                  <Textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={7}
                    placeholder={'建议按「角色 / 任务 / 硬性要求 / 输出格式」分段写。\n例：\n【角色】你是本书的节奏编辑。\n【任务】……\n【硬性要求】1. ……\n【输出格式】……'}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setPublishOpen(false)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={handlePublish}
                    disabled={submitting}
                    className="bg-primary hover:bg-primary/90 rounded-full shadow-sm"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                    确认发布
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 整合说明 */}
      <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
        <Layers className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
        <p className="leading-relaxed">
          模板已按「角色 · 任务 · 硬性要求 · 输出格式」结构编写，点击「套用」即可加入你的设定库，并在 AI 写作助手中随时调用（自动结合作品设定集、大纲与你的个人文风）。
        </p>
      </div>

      {/* 模板卡片网格 */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">加载模板市场中...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">暂无匹配的提示词模板</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const isSaved = savedIds.includes(item.id)
            return (
              <Card key={item.id} className={`flex flex-col transition ${isSaved ? 'border-primary/60 ring-1 ring-primary/15' : 'hover:border-primary/40'}`}>
                <CardHeader className="p-4 pb-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {item.category}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      {isSaved && (
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                          已加入设定库
                        </Badge>
                      )}
                      {item.isOfficial && (
                        <Badge className="text-[10px] bg-gold text-white hover:bg-gold/90">
                          精选官方
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardTitle
                    className="text-sm leading-snug font-display cursor-pointer hover:text-primary transition-colors"
                    onClick={() => setDetailItem(item)}
                  >
                    {item.title}
                  </CardTitle>
                  <CardDescription className="text-xs line-clamp-2">{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-1">
                    <div
                      onClick={() => setDetailItem(item)}
                      className="rounded bg-muted/40 p-2.5 text-[11px] text-muted-foreground max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed cursor-pointer hover:bg-muted/60 transition-colors"
                      title="点击查看完整提示词"
                    >
                      {item.promptText}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      查看完整内容
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <div className="flex items-center gap-3">
                      <span>@{item.authorName}</span>
                      <span className="flex items-center gap-1">
                        <Flame className="w-3 h-3 text-gold" />
                        {item.useCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => handleLike(item.id)}
                      >
                        <Heart className="w-3.5 h-3.5 text-cinnabar" />
                        {item.likesCount}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          void navigator.clipboard.writeText(item.promptText)
                          toast.success('已复制提示词')
                        }}
                        title="复制提示词"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant={isSaved ? 'secondary' : 'default'}
                        className={`h-7 px-2.5 text-xs gap-1 rounded-full ${isSaved ? 'border border-primary/30 text-primary' : 'bg-primary hover:bg-primary/90 shadow-sm'}`}
                        onClick={() => handleToggleSave(item)}
                      >
                        <Sparkles className="w-3 h-3" />
                        {isSaved ? '已套用' : '套用'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 提示词完整内容查看弹窗 */}
      <Dialog open={!!detailItem} onOpenChange={(v) => !v && setDetailItem(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {detailItem && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-xs">{detailItem.category}</Badge>
                  <span className="text-xs text-muted-foreground">@{detailItem.authorName}</span>
                </div>
                <DialogTitle className="text-base">{detailItem.title}</DialogTitle>
                <p className="text-xs text-muted-foreground">{detailItem.description}</p>
              </DialogHeader>
              <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3.5 text-xs leading-relaxed whitespace-pre-wrap select-text">
                {detailItem.promptText}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => {
                    onApplyPrompt(detailItem.promptText, { id: detailItem.id, title: detailItem.title, category: detailItem.category })
                    setDetailItem(null)
                  }}
                >
                  去工具箱测试
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => {
                      void navigator.clipboard.writeText(detailItem.promptText)
                      toast.success('已复制完整提示词')
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    复制全文
                  </Button>
                  <Button
                    size="sm"
                    variant={savedIds.includes(detailItem.id) ? 'secondary' : 'default'}
                    className="text-xs gap-1"
                    onClick={() => handleToggleSave(detailItem)}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {savedIds.includes(detailItem.id) ? '取消套用' : '套用到设定库'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
