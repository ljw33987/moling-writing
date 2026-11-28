/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/helpers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getSavedPrompts,
  removeSavedPrompt,
  savePromptToLibrary,
  SAVED_PROMPTS_EVENT,
  type SavedPromptItem,
} from '@/lib/saved-prompts'

type CardType = 'character' | 'worldview' | 'item'

interface SettingCard {
  id: string
  name: string
  // character
  avatar?: string
  appearance?: string
  personality?: string
  background?: string
  abilities?: string
  relations?: string
  // worldview
  type?: string
  description?: string
  // item
  attributes?: string
  effect?: string
  novelId?: string | null
  novel?: { id: string; title: string } | null
}

interface NovelOption {
  id: string
  title: string
}

const TYPE_LABELS: Record<CardType, { label: string; color: string }> = {
  character: { label: '角色卡', color: 'text-primary' },
  worldview: { label: '世界观', color: 'text-jade' },
  item: { label: '道具/功法', color: 'text-gold' },
}

export function SettingsLibrary() {
  const [type, setType] = useState<CardType | 'prompts'>('character')
  const [cards, setCards] = useState<SettingCard[]>([])
  const [savedPrompts, setSavedPrompts] = useState<SavedPromptItem[]>([])
  const [newPromptTitle, setNewPromptTitle] = useState('')
  const [newPromptText, setNewPromptText] = useState('')
  const [showNewPrompt, setShowNewPrompt] = useState(false)
  const [query, setQuery] = useState('')
  const [novelFilter, setNovelFilter] = useState<string>('all')
  const [novels, setNovels] = useState<NovelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<SettingCard | null>(null)
  const [open, setOpen] = useState(false)
  const [aiGenOpen, setAiGenOpen] = useState(false)
  const [aiGenLoading, setAiGenLoading] = useState(false)
  const [backstoryCard, setBackstoryCard] = useState<SettingCard | null>(null)
  const [backstoryBrief, setBackstoryBrief] = useState('冷漠，孤儿，剑修')
  const [backstoryLoading, setBackstoryLoading] = useState(false)

  const load = useCallback(async () => {
    if (type === 'prompts') return
    setLoading(true)
    try {
      const r = await api<{ items: SettingCard[] }>(`/api/characters?type=${type}`)
      setCards(r.items)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    api<{ novels: NovelOption[] }>('/api/novels')
      .then((r) => setNovels(r.novels || []))
      .catch(() => { })
  }, [])

  useEffect(() => {
    const sync = () => setSavedPrompts(getSavedPrompts())
    sync()
    window.addEventListener(SAVED_PROMPTS_EVENT, sync)
    return () => window.removeEventListener(SAVED_PROMPTS_EVENT, sync)
  }, [])

  const handleSave = async (data: Partial<SettingCard>) => {
    const { type: subtype, ...fields } = data
    try {
      if (editing?.id) {
        await api('/api/characters', {
          method: 'PATCH',
          body: JSON.stringify({ ...fields, id: editing.id, type, subtype }),
        })
        toast.success('已更新')
      } else {
        await api('/api/characters', {
          method: 'POST',
          body: JSON.stringify({ ...fields, type, subtype }),
        })
        toast.success('已创建')
      }
      setOpen(false)
      setEditing(null)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该设定卡？')) return
    try {
      await api(`/api/characters?id=${id}&type=${type}`, { method: 'DELETE' })
      toast.success('已删除')
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleAIGenerate = async (card: SettingCard) => {
    if (type === 'character') {
      setBackstoryCard(card)
      setBackstoryBrief(card.personality?.trim() || '冷漠，孤儿，剑修')
    }
  }

  const handleConfirmBackstory = async () => {
    if (!backstoryCard || !backstoryBrief.trim()) return
    setBackstoryLoading(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          preset: 'char_backstory',
          message: `角色名：${backstoryCard.name}\n关键词：${backstoryBrief.trim()}`,
        }),
      })
      await api('/api/characters', {
        method: 'PATCH',
        body: JSON.stringify({ id: backstoryCard.id, type, background: r.reply }),
      })
      toast.success('AI 已生成角色小传')
      setBackstoryCard(null)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBackstoryLoading(false)
    }
  }

  // AI 生成单个设定（根据当前 Tab 类型）
  const handleAIGenSingle = async (genre: string, keywords: string) => {
    setAiGenLoading(true)
    try {
      const presetMap: Record<CardType, string> = {
        character: 'gen_character',
        worldview: 'gen_worldview',
        item: 'gen_item',
      }
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          preset: presetMap[type],
          message: `小说类型：${genre}\n关键词/要求：${keywords}`,
        }),
      })

      // 解析 AI 返回的格式化文本
      const lines = r.reply.split('\n').filter((l) => l.trim())
      const parsed: any = {}
      for (const line of lines) {
        const idx = line.indexOf('：')
        if (idx > 0) {
          const key = line.slice(0, idx).trim()
          const val = line.slice(idx + 1).trim()
          const keyMap: Record<string, string> = {
            '姓名': 'name', '名称': 'name',
            '外貌': 'appearance', '性格': 'personality',
            '背景': 'background', '功法/能力': 'abilities', '功法': 'abilities', '能力': 'abilities',
            '人物关系': 'relations', '关系': 'relations',
            '类型': 'type', '描述': 'description',
            '属性': 'attributes', '效果': 'effect',
          }
          const mappedKey = keyMap[key]
          if (mappedKey) parsed[mappedKey] = val
        }
      }

      if (!parsed.name) {
        toast.error('AI 返回格式异常，未能解析名称')
        return
      }

      // 创建设定卡
      await api('/api/characters', {
        method: 'POST',
        body: JSON.stringify({ type, ...parsed }),
      })
      toast.success(`AI 已生成${type === 'character' ? '角色' : type === 'worldview' ? '世界观' : '道具/功法'}：${parsed.name}`)
      load()
      setAiGenOpen(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAiGenLoading(false)
    }
  }

  // AI 批量生成全套设定
  const handleAIGenBatch = async (genre: string, theme: string) => {
    setAiGenLoading(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          preset: 'gen_settings_batch',
          message: `小说类型：${genre}\n主题/方向：${theme}`,
        }),
      })

      // 尝试解析 JSON
      let jsonStr = r.reply.trim()
      // 去除可能的 markdown 代码块标记
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const data = JSON.parse(jsonStr)

      let count = 0
      // 创建角色
      if (data.characters) {
        for (const c of data.characters) {
          await api('/api/characters', {
            method: 'POST',
            body: JSON.stringify({ ...c, type: 'character' }),
          })
          count++
        }
      }
      // 创建世界观
      if (data.worldviews) {
        for (const w of data.worldviews) {
          await api('/api/characters', {
            method: 'POST',
            body: JSON.stringify({ ...w, type: 'worldview', subtype: w.type }),
          })
          count++
        }
      }
      // 创建道具
      if (data.items) {
        for (const it of data.items) {
          await api('/api/characters', {
            method: 'POST',
            body: JSON.stringify({ ...it, type: 'item', subtype: it.type }),
          })
          count++
        }
      }

      toast.success(`AI 批量生成完成，共 ${count} 个设定`)
      load()
      setAiGenOpen(false)
    } catch (e: any) {
      toast.error('AI 生成失败：' + e.message)
    } finally {
      setAiGenLoading(false)
    }
  }

  return (
    <div className="studio-settings flex-1 overflow-auto">
      <div className="max-w-[1560px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="studio-page-title font-display">设定库</h2>
            <p className="text-sm text-muted-foreground mt-1">
              独立管理角色、世界观、道具设定，AI 写作时自动注入上下文
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setAiGenOpen(true)}
              variant="outline"
              className="gap-1.5 bg-gradient-to-r from-gold/15 to-gold/5 dark:from-gold/20 dark:to-gold/10 border-gold/40 text-gold hover:bg-gold/15 dark:hover:bg-gold/15"
            >
              AI 生成设定
            </Button>
            {type !== 'prompts' && (
              <Button
                onClick={() => {
                  setEditing(null)
                  setOpen(true)
                }}
                className="gap-1.5"
              >
                新建{TYPE_LABELS[type].label}
              </Button>
            )}
          </div>
        </div>

        <Tabs className="studio-settings-layout" value={type} onValueChange={(value) => {
          setQuery('')
          setType(value as CardType)
        }}>
          <TabsList>
            <TabsTrigger value="character" className="gap-1.5">
              角色卡 ({cards.length})
            </TabsTrigger>
            <TabsTrigger value="worldview" className="gap-1.5">
              世界观
            </TabsTrigger>
            <TabsTrigger value="item" className="gap-1.5">
              道具/功法
            </TabsTrigger>
            <TabsTrigger value="prompts" className="gap-1.5">
              提示词模板
            </TabsTrigger>
          </TabsList>

          {type === 'prompts' ? (
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">我的已选提示词（{savedPrompts.length}）</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    仅显示你在「AI 工具箱 → 提示词模板市场」中点击「套用」的模板，或在此新建的专属提示词；可在 AI 写作助手中直接调用或在此取消。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={showNewPrompt ? 'outline' : 'default'}
                  className="h-8 text-xs gap-1"
                  onClick={() => setShowNewPrompt((v) => !v)}
                >
                  {showNewPrompt ? '收起' : '新建提示词'}
                </Button>
              </div>

              {showNewPrompt && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <Input
                      value={newPromptTitle}
                      onChange={(e) => setNewPromptTitle(e.target.value)}
                      placeholder="提示词名称（如：古风环境白描指令）"
                      className="h-8 text-xs"
                    />
                    <Textarea
                      value={newPromptText}
                      onChange={(e) => setNewPromptText(e.target.value)}
                      placeholder="输入具体提示词内容..."
                      rows={3}
                      className="text-xs resize-y"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (!newPromptTitle.trim() || !newPromptText.trim()) {
                            toast.error('请填写名称和提示词内容')
                            return
                          }
                          savePromptToLibrary({
                            id: `custom_${Date.now()}`,
                            title: newPromptTitle.trim(),
                            category: '自定义',
                            description: '我在设定库创建的个人提示词',
                            promptText: newPromptText.trim(),
                          })
                          setNewPromptTitle('')
                          setNewPromptText('')
                          setShowNewPrompt(false)
                          toast.success('已添加到我的设定库提示词')
                        }}
                      >
                        保存到设定库
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {savedPrompts.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm font-medium">还没有选入任何提示词</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      前往「AI 工具箱 → 提示词模板市场」点击任意模板的「套用」，它就会出现在这里；或点击上方「新建提示词」。
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savedPrompts.map((sp) => (
                    <Card key={sp.id} className="flex flex-col">
                      <CardHeader className="p-4 pb-2 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {sp.category}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px] text-cinnabar hover:text-cinnabar gap-1"
                            onClick={() => {
                              removeSavedPrompt(sp.id)
                              toast.success(`已从设定库取消「${sp.title}」`)
                            }}
                          >
                            取消套用
                          </Button>
                        </div>
                        <CardTitle className="text-sm font-display">{sp.title}</CardTitle>
                        {sp.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">{sp.description}</p>
                        )}
                      </CardHeader>
                      <CardContent className="p-4 pt-2 flex-1 flex flex-col justify-between gap-2">
                        <div className="rounded bg-muted/40 p-2.5 text-[11px] text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                          {sp.promptText}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs gap-1"
                            onClick={() => {
                              navigator.clipboard.writeText(sp.promptText)
                              toast.success('已复制提示词')
                            }}
                          >
                            复制
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <TabsContent value={type} className="min-w-0">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : cards.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="font-medium">还没有{TYPE_LABELS[type].label}</p>
                  <p className="text-sm text-muted-foreground mt-1">创建第一条设定，开始搭建作品资料</p>
                  <Button size="sm" className="mt-4 gap-1.5" onClick={() => { setEditing(null); setOpen(true) }}>
                    新建{TYPE_LABELS[type].label}
                  </Button>
                  </CardContent>
                </Card>
              ) : (
                <SettingsBrowser
                  cards={cards}
                  type={type}
                  query={query}
                  onQueryChange={setQuery}
                  novels={novels}
                  novelFilter={novelFilter}
                  onNovelFilterChange={setNovelFilter}
                  onEdit={(card) => {
                    setEditing(card)
                    setOpen(true)
                  }}
                  onDelete={handleDelete}
                  onAIGenerate={handleAIGenerate}
                  onCreate={() => {
                    setEditing(null)
                    setOpen(true)
                  }}
                />
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      <SettingCardDialog
        open={open}
        onClose={() => {
          setOpen(false)
          setEditing(null)
        }}
        type={type === 'prompts' ? 'character' : type}
        card={editing}
        novels={novels}
        onSave={handleSave}
      />

      {/* AI 生成设定对话框 */}
      <AIGenDialog
        open={aiGenOpen}
        onClose={() => setAiGenOpen(false)}
        type={type === 'prompts' ? 'character' : type}
        onGenSingle={handleAIGenSingle}
        onGenBatch={handleAIGenBatch}
        loading={aiGenLoading}
      />

      <Dialog open={!!backstoryCard} onOpenChange={(v) => !v && setBackstoryCard(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              AI 生成「{backstoryCard?.name}」背景小传
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">性格与背景关键词</Label>
            <Textarea
              value={backstoryBrief}
              onChange={(e) => setBackstoryBrief(e.target.value)}
              rows={3}
              className="text-xs"
              placeholder="如：冷漠，孤儿，剑修，身负灭门血仇..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBackstoryCard(null)}>
              取消
            </Button>
            <Button size="sm" disabled={backstoryLoading || !backstoryBrief.trim()} onClick={handleConfirmBackstory}>
              {backstoryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              {backstoryLoading ? '生成中...' : '生成小传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SettingsBrowser({
  cards,
  type,
  query,
  onQueryChange,
  novels,
  novelFilter,
  onNovelFilterChange,
  onEdit,
  onDelete,
  onAIGenerate,
  onCreate,
}: {
  cards: SettingCard[]
  type: CardType
  query: string
  onQueryChange: (query: string) => void
  novels: NovelOption[]
  novelFilter: string
  onNovelFilterChange: (novelId: string) => void
  onEdit: (card: SettingCard) => void
  onDelete: (id: string) => void
  onAIGenerate: (card: SettingCard) => void
  onCreate: () => void
}) {
  const matches = cards.filter((card) => {
    const matchName = card.name.toLowerCase().includes(query.trim().toLowerCase())
    if (!matchName) return false
    if (novelFilter === 'all') return true
    if (novelFilter === '__global__') return !card.novelId
    return card.novelId === novelFilter
  })
  return (
    <div className="space-y-4">
      <div className="studio-settings-toolbar">
        <div className="relative flex-1 min-w-[220px]">
          <Input aria-label="搜索设定" placeholder="搜索设定…" value={query} onChange={(event) => onQueryChange(event.target.value)} />
        </div>
        <Select value={novelFilter} onValueChange={onNovelFilterChange}>
          <SelectTrigger className="h-10 w-full sm:w-[220px] text-sm" aria-label="按所属作品筛选">
            <SelectValue placeholder="全部作品" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">全部作品 ({cards.length})</SelectItem>
            <SelectItem value="__global__" className="text-xs">通用设定（不限作品）</SelectItem>
            {novels.map((n) => (
              <SelectItem key={n.id} value={n.id} className="text-xs">
                《{n.title}》
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="studio-settings-count">{matches.length} 条设定</span>
      </div>
      {matches.length ? (
        <div className="studio-settings-card-list">
          {matches.map((card) => (
            <SettingCardItem
              key={card.id}
              card={card}
              type={type}
              onEdit={() => onEdit(card)}
              onDelete={() => onDelete(card.id)}
              onAIGenerate={() => onAIGenerate(card)}
            />
          ))}
          <button type="button" className="studio-settings-create-card" onClick={onCreate}>
            <span className="text-sm font-semibold">快速创建{TYPE_LABELS[type].label}</span>
            <span className="mt-1 text-xs text-muted-foreground">填写资料并加入设定库</span>
          </button>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <p className="mt-2 text-sm text-muted-foreground">没有匹配的设定</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SettingCardItem({
  card,
  type,
  onEdit,
  onDelete,
  onAIGenerate,
}: {
  card: SettingCard
  type: CardType
  onEdit: () => void
  onDelete: () => void
  onAIGenerate: () => void
}) {
  const summary = type === 'character'
    ? [card.appearance, card.personality, card.abilities, card.background].filter(Boolean).join(' · ')
    : type === 'worldview'
      ? card.description || ''
      : [card.attributes, card.effect].filter(Boolean).join(' · ')

  return (
    <Card className={`studio-setting-card studio-setting-card-${type}`}>
      <div className="studio-setting-main">
        <CardHeader className="studio-setting-card-header">
          <div className="min-w-0 flex-1">
            <CardTitle className="studio-setting-name">{card.name}</CardTitle>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-[10px]">{type === 'character' ? '角色' : type === 'worldview' ? '世界观' : card.type === 'item' ? '道具' : '功法'}</Badge>
              <Badge variant="secondary" className="text-[10px] truncate max-w-[180px]">
                {card.novel?.title ? `《${card.novel.title}》` : '通用设定'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="studio-setting-card-content">
          <p className="studio-setting-summary">{summary || '还没有填写详细设定'}</p>
          {type === 'character' && card.relations && (
            <span className="studio-setting-relation">已设定人物关系</span>
          )}
          {type === 'character' && !card.background && (
            <Button variant="outline" size="sm" className="studio-setting-generate text-xs" onClick={onAIGenerate}>
              AI 生成背景小传
            </Button>
          )}
        </CardContent>
      </div>
      <div className="studio-setting-row-actions">
        <Button variant="outline" size="sm" className="h-8 px-3 text-xs" aria-label="编辑设定" onClick={onEdit}>
          编辑
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-3 text-xs text-cinnabar hover:bg-cinnabar/10" aria-label="删除设定" onClick={onDelete}>
          删除
        </Button>
      </div>
    </Card>
  )
}

function SettingCardDialog({
  open,
  onClose,
  type,
  card,
  novels,
  onSave,
}: {
  open: boolean
  onClose: () => void
  type: CardType
  card: SettingCard | null
  novels: NovelOption[]
  onSave: (data: Partial<SettingCard>) => void
}) {
  const [form, setForm] = useState<Partial<SettingCard>>({})

  useEffect(() => {
    if (card) {
      setForm(card)
    } else {
      setForm({ name: '', type: type === 'worldview' ? 'geography' : type === 'item' ? 'item' : undefined })
    }
  }, [card, type, open])

  const set = (k: keyof SettingCard, v: any) => setForm((prev) => ({ ...prev, [k]: v }))

  const handleSave = () => {
    if (!form.name?.trim()) {
      toast.error('请输入名称')
      return
    }
    onSave(form)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {card ? '编辑' : '新建'}
            {TYPE_LABELS[type]?.label || '设定'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>名称 *</Label>
              <Input
                value={form.name || ''}
                onChange={(e) => set('name', e.target.value)}
                placeholder={type === 'character' ? '角色名' : type === 'worldview' ? '设定名' : '道具名'}
              />
            </div>
            {type === 'character' && (
              <div className="space-y-2">
                <Label>头像 URL（可选）</Label>
                <Input
                  value={form.avatar || ''}
                  onChange={(e) => set('avatar', e.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}
            {type === 'worldview' && (
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={form.type || 'geography'} onValueChange={(v) => set('type', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="geography">地理</SelectItem>
                    <SelectItem value="faction">势力</SelectItem>
                    <SelectItem value="history">历史</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {type === 'item' && (
              <div className="space-y-2">
                <Label>类型</Label>
                <Select value={form.type || 'item'} onValueChange={(v) => set('type', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="item">道具</SelectItem>
                    <SelectItem value="skill">功法/技能</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>所属作品</Label>
            <Select
              value={form.novelId || '__global__'}
              onValueChange={(v) => set('novelId', v === '__global__' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="通用设定（不限作品）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__">通用设定（不限作品）</SelectItem>
                {novels.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    《{n.title}》
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'character' && (
            <>
              <div className="space-y-2">
                <Label>外貌</Label>
                <Textarea
                  value={form.appearance || ''}
                  onChange={(e) => set('appearance', e.target.value)}
                  placeholder="身高、面容、衣着..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>性格</Label>
                <Textarea
                  value={form.personality || ''}
                  onChange={(e) => set('personality', e.target.value)}
                  placeholder="性格特点、说话方式..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>功法/能力</Label>
                <Textarea
                  value={form.abilities || ''}
                  onChange={(e) => set('abilities', e.target.value)}
                  placeholder="修炼功法、特殊能力..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>背景小传</Label>
                <Textarea
                  value={form.background || ''}
                  onChange={(e) => set('background', e.target.value)}
                  placeholder="身世、经历、目标..."
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>人物关系（JSON 或文字描述）</Label>
                <Textarea
                  value={form.relations || ''}
                  onChange={(e) => set('relations', e.target.value)}
                  placeholder={'如：\n父亲：李老汉\n挚友：王二\n宿敌：黑衣人'}
                  rows={3}
                />
              </div>
            </>
          )}

          {type === 'worldview' && (
            <div className="space-y-2">
              <Label>详细描述</Label>
              <Textarea
                value={form.description || ''}
                onChange={(e) => set('description', e.target.value)}
                placeholder="地理位置、势力分布、历史背景..."
                rows={8}
              />
            </div>
          )}

          {type === 'item' && (
            <>
              <div className="space-y-2">
                <Label>属性</Label>
                <Textarea
                  value={form.attributes || ''}
                  onChange={(e) => set('attributes', e.target.value)}
                  placeholder="等级、属性、来源..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>效果</Label>
                <Textarea
                  value={form.effect || ''}
                  onChange={(e) => set('effect', e.target.value)}
                  placeholder="使用效果、副作用、限制..."
                  rows={4}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ AI 生成设定对话框 ============
function AIGenDialog({
  open,
  onClose,
  type,
  onGenSingle,
  onGenBatch,
  loading,
}: {
  open: boolean
  onClose: () => void
  type: CardType
  onGenSingle: (genre: string, keywords: string) => void
  onGenBatch: (genre: string, theme: string) => void
  loading: boolean
}) {
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [genre, setGenre] = useState('玄幻')
  const [keywords, setKeywords] = useState('')
  const [theme, setTheme] = useState('')

  const typeLabel = type === 'character' ? '角色' : type === 'worldview' ? '世界观' : '道具/功法'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            AI 自动生成设定
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* 模式切换 */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === 'single' ? 'default' : 'outline'}
              onClick={() => setMode('single')}
              className="gap-1.5 text-sm"
            >
              生成单个{typeLabel}
            </Button>
            <Button
              variant={mode === 'batch' ? 'default' : 'outline'}
              onClick={() => setMode('batch')}
              className="gap-1.5 text-sm"
            >
              批量生成全套
            </Button>
          </div>

          {mode === 'single' ? (
            <>
              <div className="space-y-2">
                <Label>小说类型</Label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['玄幻', '言情', '科幻', '悬疑', '历史', '都市', '武侠', '游戏', '奇幻'].map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>关键词 / 要求</Label>
                <Textarea
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={
                    type === 'character'
                      ? '如：反派，冷酷，剑修，与主角有血海深仇'
                      : type === 'worldview'
                        ? '如：修仙宗门，位于悬崖之上，有禁地'
                        : '如：上古神器，可操控时间，有反噬'
                  }
                  rows={3}
                />
              </div>
              <div className="bg-gold/10 dark:bg-gold/15 border border-gold/30 rounded p-3 text-xs text-gold">
                AI 会根据类型和关键词自动生成一个完整的{typeLabel}设定卡，直接保存到设定库
              </div>
              <Button
                onClick={() => onGenSingle(genre, keywords)}
                disabled={loading || !keywords.trim()}
                className="w-full gap-1.5 bg-gradient-to-r from-gold to-gold/75 text-ink hover:opacity-90"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'AI 生成中...' : `生成${typeLabel}`}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>小说类型</Label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['玄幻', '言情', '科幻', '悬疑', '历史', '都市', '武侠', '游戏', '奇幻'].map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>主题 / 方向</Label>
                <Textarea
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="如：废材逆袭，系统流，校园+修仙..."
                  rows={3}
                />
              </div>
              <div className="bg-gold/10 dark:bg-gold/15 border border-gold/30 rounded p-3 text-xs text-gold">
                AI 会一次性生成：3 个角色 + 2 个世界观 + 2 个道具/功法，共 7 个设定卡
              </div>
              <Button
                onClick={() => onGenBatch(genre, theme)}
                disabled={loading || !theme.trim()}
                className="w-full gap-1.5 bg-gradient-to-r from-gold to-gold/75 text-ink hover:opacity-90"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'AI 批量生成中...' : '批量生成全套设定'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
