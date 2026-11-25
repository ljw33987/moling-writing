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
import { Search, Heart, Copy, Sparkles, Plus, Flame, Loader2 } from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'

const CATEGORIES = ['全部', '开篇钩子', '大纲模板', '人物设定', '爽点打磨', '去AI味', '对话张力']

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
  onApplyPrompt: (promptText: string) => void
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

  const handleUse = async (item: PromptItem) => {
    api('/api/prompts', {
      method: 'PATCH',
      body: JSON.stringify({ id: item.id, action: 'use' }),
    }).catch(() => {})
    onApplyPrompt(`${item.promptText}\n\n`)
    toast.success(`已套用「${item.title}」，请在下方补充你的剧情后点击生成`)
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
              className={`h-7 text-xs ${
                category === cat ? 'bg-gradient-to-r from-indigo-600 to-blue-600' : ''
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
                className="h-8 gap-1 text-xs bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90 shrink-0"
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
                    rows={5}
                    placeholder="写清楚给 AI 的角色定位、约束要求与输出格式..."
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
                    className="bg-gradient-to-r from-indigo-600 to-blue-600"
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

      {/* 模板卡片网格 */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">加载模板市场中...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">暂无匹配的提示词模板</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col hover:border-indigo-400/70 transition">
              <CardHeader className="p-4 pb-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {item.category}
                  </Badge>
                  {item.isOfficial && (
                    <Badge className="text-[10px] bg-amber-500/90 hover:bg-amber-500">
                      精选官方
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-sm leading-snug">{item.title}</CardTitle>
                <CardDescription className="text-xs line-clamp-2">{item.description}</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2 flex-1 flex flex-col justify-between gap-3">
                <div className="rounded bg-muted/40 p-2.5 text-[11px] text-muted-foreground line-clamp-3 leading-relaxed">
                  {item.promptText}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                  <div className="flex items-center gap-3">
                    <span>@{item.authorName}</span>
                    <span className="flex items-center gap-1">
                      <Flame className="w-3 h-3 text-amber-500" />
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
                      <Heart className="w-3.5 h-3.5 text-rose-500" />
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
                      className="h-7 px-2.5 text-xs gap-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90"
                      onClick={() => handleUse(item)}
                    >
                      <Sparkles className="w-3 h-3" />
                      套用
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
