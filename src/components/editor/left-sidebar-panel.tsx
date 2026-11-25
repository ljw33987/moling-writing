'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ChapterTree } from './chapter-tree'
import type { NovelDetail } from './editor-view'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import { BookText, FileText, Users, Save, Search, AtSign } from 'lucide-react'

interface Props {
  novel: NovelDetail
  currentChapterId: string | null
  onSelectChapter: (id: string) => void
  onTreeChange: () => void
  onInsertCodexRef?: (id: string) => void
}

export function LeftSidebarPanel({
  novel,
  currentChapterId,
  onSelectChapter,
  onTreeChange,
  onInsertCodexRef,
}: Props) {
  const [tab, setTab] = useState<'chapters' | 'outline' | 'codex'>('chapters')

  // 大纲编辑状态
  const [synopsis, setSynopsis] = useState(novel.synopsis || '')
  const [outline, setOutline] = useState(novel.outline || '')
  const [savingOutline, setSavingOutline] = useState(false)

  useEffect(() => {
    setSynopsis(novel.synopsis || '')
    setOutline(novel.outline || '')
  }, [novel.id, novel.synopsis, novel.outline])

  // 设定速查状态
  const [codexQuery, setCodexQuery] = useState('')
  const [codexItems, setCodexItems] = useState<
    Array<{ id: string; name: string; type: 'character' | 'worldview' | 'item'; summary: string }>
  >([])

  const loadCodex = useCallback(async () => {
    try {
      const [charR, worldR, itemR] = await Promise.all([
        api<{ items: any[] }>(`/api/characters?type=character&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/api/characters?type=worldview&novelId=${novel.id}`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/api/characters?type=item&novelId=${novel.id}`).catch(() => ({ items: [] })),
      ])
      setCodexItems([
        ...charR.items.map((c) => ({
          id: c.id,
          name: c.name,
          type: 'character' as const,
          summary: c.personality || c.background || '暂无描述',
        })),
        ...worldR.items.map((w) => ({
          id: w.id,
          name: w.name || w.title,
          type: 'worldview' as const,
          summary: w.description || '暂无描述',
        })),
        ...itemR.items.map((i) => ({
          id: i.id,
          name: i.name,
          type: 'item' as const,
          summary: i.effect || i.attributes || '暂无描述',
        })),
      ])
    } catch {}
  }, [novel.id])

  useEffect(() => {
    if (tab !== 'codex') return
    const timer = setTimeout(() => {
      void loadCodex()
    }, 0)
    return () => clearTimeout(timer)
  }, [tab, loadCodex])

  const handleSaveOutline = async () => {
    setSavingOutline(true)
    try {
      await api('/api/novels', {
        method: 'PATCH',
        body: JSON.stringify({ id: novel.id, synopsis, outline }),
      })
      toast.success('简介与大纲已保存')
      onTreeChange()
    } catch (e: any) {
      toast.error(e.message || '保存失败')
    } finally {
      setSavingOutline(false)
    }
  }

  const filteredCodex = codexQuery.trim()
    ? codexItems.filter((i) => i.name.toLowerCase().includes(codexQuery.trim().toLowerCase()))
    : codexItems

  return (
    <div className="h-full flex flex-col bg-card/30 border-r border-border">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'chapters' | 'outline' | 'codex')}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="grid grid-cols-3 rounded-none border-b border-border h-9 bg-muted/30 px-1 shrink-0">
          <TabsTrigger value="chapters" className="text-xs gap-1 h-7">
            <FileText className="w-3 h-3" />
            目录
          </TabsTrigger>
          <TabsTrigger value="outline" className="text-xs gap-1 h-7">
            <BookText className="w-3 h-3" />
            大纲
          </TabsTrigger>
          <TabsTrigger value="codex" className="text-xs gap-1 h-7">
            <Users className="w-3 h-3" />
            设定
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chapters" className="flex-1 overflow-hidden mt-0">
          <ChapterTree
            novel={novel}
            currentChapterId={currentChapterId}
            onSelect={onSelectChapter}
            onChange={onTreeChange}
          />
        </TabsContent>

        <TabsContent value="outline" className="flex-1 overflow-y-auto p-3 space-y-3 mt-0">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">作品简介</div>
            <Textarea
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              rows={4}
              className="text-xs resize-none"
              placeholder="输入作品简介..."
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">全书大纲 / 分卷细纲</div>
            <Textarea
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              rows={12}
              className="text-xs"
              placeholder="输入总大纲或分卷脉络，AI 续写时会自动注入上下文..."
            />
          </div>
          <Button
            size="sm"
            className="w-full gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90"
            onClick={handleSaveOutline}
            disabled={savingOutline}
          >
            <Save className="w-3.5 h-3.5" />
            {savingOutline ? '保存中...' : '保存大纲'}
          </Button>
        </TabsContent>

        <TabsContent value="codex" className="flex-1 flex flex-col overflow-hidden p-3 gap-2 mt-0">
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={codexQuery}
              onChange={(e) => setCodexQuery(e.target.value)}
              placeholder="搜索角色/世界观/道具..."
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredCodex.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                暂无设定条目，可在顶部「设定库」添加
              </p>
            ) : (
              filteredCodex.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-background p-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{item.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {item.type === 'character' ? '角色' : item.type === 'worldview' ? '世界观' : '道具'}
                      </Badge>
                      {onInsertCodexRef && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px] text-indigo- dark:text-indigo-"
                          onClick={() => onInsertCodexRef(item.id)}
                          title="插入 @ 引用到当前光标"
                        >
                          <AtSign className="w-3 h-3 mr-0.5" />
                          引用
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{item.summary}</p>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
