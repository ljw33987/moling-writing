'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sparkles,
  BookOpen,
  Zap,
  Flame,
  Wand2,
  MessageSquare,
  Compass,
  FileSearch,
  Award,
  Upload,
  Copy,
  Loader2,
  Check,
} from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'

interface ToolDef {
  id: string
  preset: string
  title: string
  badge: string
  desc: string
  placeholder: string
  icon: any
}

const TOOLS: ToolDef[] = [
  {
    id: 'synopsis',
    preset: 'synopsis',
    title: '书名与爆款简介',
    badge: '建书',
    desc: '输入一句话脑洞，一键生成吸睛简介、初步大纲与核心角色',
    placeholder: '例：末日降临，别人觉醒异能，我觉醒了一家只在深夜营业的便利店，卖出的泡面能续命…',
    icon: BookOpen,
  },
  {
    id: 'goldfinger',
    preset: 'goldfinger',
    title: '金手指 / 脑洞生成',
    badge: '策划',
    desc: '设计 3 套有爽点、有成长上限、带首个高潮兑现的金手指方案',
    placeholder: '例：都市修仙 / 历史种田 / 系统流，希望主角前期低调发育、打脸爽感强…',
    icon: Zap,
  },
  {
    id: 'golden_three',
    preset: 'golden_three',
    title: '黄金三章开篇',
    badge: '正文',
    desc: '专攻前三章“三秒抓眼球”高能开局，快速立住矛盾与金手指',
    placeholder: '填写主角身份、开局困境、金手指触发契机及前三章核心事件…',
    icon: Flame,
  },
  {
    id: 'name_gen',
    preset: 'name_gen',
    title: '网文起名器',
    badge: '高频',
    desc: '批量生成角色名、宗门、功法、法宝、势力名并附风格说明',
    placeholder: '例：生成 10 个仙侠剑修宗门名与镇派剑诀名，要求偏冷冽孤高风格',
    icon: Wand2,
  },
  {
    id: 'char_dialogue',
    preset: 'char_dialogue',
    title: '精彩冲突对话',
    badge: '正文',
    desc: '输入两个角色性格与矛盾点，生成有张力的多轮对白',
    placeholder: '例：冷面师姐（柳清霜）质问隐忍杂役（沈默）为何偷学禁地剑意，表面问责实则试探…',
    icon: MessageSquare,
  },
  {
    id: 'break_block',
    preset: 'break_block',
    title: '卡文破局思路',
    badge: '辅助',
    desc: '写到一半卡住？快速给出 3 种不同方向的反转与推进方案',
    placeholder: '描述你当前卡住的剧情节点，以及希望保持的基调…',
    icon: Compass,
  },
  {
    id: 'deconstruct',
    preset: 'deconstruct',
    title: '拆书分析（样章拆解）',
    badge: '拆书',
    desc: '粘贴爆款小说章节，拆解开篇钩子、情绪节奏、爽点与可复用章纲模板',
    placeholder: '请粘贴 500~4000 字的对标样章正文…',
    icon: FileSearch,
  },
  {
    id: 'editor_review',
    preset: 'editor_review',
    title: '网文编辑审稿评分',
    badge: '审稿',
    desc: '模拟起点/番茄资深编辑，从逻辑、人设、节奏、爽点多维打分并给修改建议',
    placeholder: '请粘贴待审稿的章节正文（建议 1000~3500 字）…',
    icon: Award,
  },
]

export function AiToolboxView() {
  const [activeTool, setActiveTool] = useState<ToolDef | null>(TOOLS[0])
  const [mode, setMode] = useState<'ai' | 'txt'>('ai')
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // TXT 智能分章导入状态
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([])
  const [targetNovelId, setTargetNovelId] = useState('')
  const [volumeTitle, setVolumeTitle] = useState('TXT 导入卷')
  const [txtContent, setTxtContent] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    api<{ novels: Array<{ id: string; title: string }> }>('/api/novels')
      .then((r) => {
        setNovels(r.novels || [])
        if (r.novels?.[0]?.id) setTargetNovelId(r.novels[0].id)
      })
      .catch(() => {})
  }, [])

  const handleRunAi = async () => {
    if (!activeTool || !prompt.trim()) {
      toast.error('请先填写输入内容')
      return
    }
    setLoading(true)
    setOutput('')
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          preset: activeTool.preset,
          message: prompt,
        }),
      })
      setOutput(r.reply || '')
      toast.success('生成完成')
    } catch (e: any) {
      toast.error(e.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!output) return
    await navigator.clipboard.writeText(output)
    setCopied(true)
    toast.success('已复制到剪贴板')
    setTimeout(() => setCopied(false), 1500)
  }

  const handleTxtFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setTxtContent(text)
    toast.success(`已读取「${file.name}」，共 ${text.length} 字符`)
  }

  const handleImportTxt = async () => {
    if (!targetNovelId || !txtContent.trim()) {
      toast.error('请选择目标作品并上传或粘贴 TXT 内容')
      return
    }
    setImporting(true)
    try {
      const r = await api<{ importedCount: number; totalWords: number }>('/api/novels/import-txt', {
        method: 'POST',
        body: JSON.stringify({
          novelId: targetNovelId,
          volumeTitle,
          rawText: txtContent,
        }),
      })
      toast.success(`成功拆分并导入 ${r.importedCount} 个章节！`)
      setTxtContent('')
    } catch (e: any) {
      toast.error(e.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* 页头 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-indigo-" />
              AI 网文创作工具箱
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              覆盖“脑洞起名 → 黄金开篇 → 拆书分析 → 编辑审稿 → TXT 智能分章导入”高频创作工具
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={mode === 'ai' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'ai' ? 'bg-gradient-to-r from-indigo-600 to-blue-600' : ''}
              onClick={() => setMode('ai')}
            >
              AI 生成与拆书
            </Button>
            <Button
              variant={mode === 'txt' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'txt' ? 'bg-gradient-to-r from-indigo-600 to-blue-600 gap-1.5' : 'gap-1.5'}
              onClick={() => setMode('txt')}
            >
              <Upload className="w-3.5 h-3.5" />
              TXT 智能分章导入
            </Button>
          </div>
        </div>

        {mode === 'txt' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">TXT 长文本智能分章导入</CardTitle>
              <CardDescription>
                自动识别 `第X章` / `第X回` / `Chapter N` 等章节标题，一键拆分并导入指定作品的新分卷
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>导入到哪部作品</Label>
                  <Select value={targetNovelId} onValueChange={setTargetNovelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择作品" />
                    </SelectTrigger>
                    <SelectContent>
                      {novels.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>新建分卷名称</Label>
                  <Input
                    value={volumeTitle}
                    onChange={(e) => setVolumeTitle(e.target.value)}
                    placeholder="TXT 导入卷"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>选择本地 .txt 文件（或直接在下方粘贴文本）</Label>
                <Input type="file" accept=".txt,text/plain" onChange={handleTxtFile} />
              </div>

              <Textarea
                value={txtContent}
                onChange={(e) => setTxtContent(e.target.value)}
                placeholder="第一章 初入宗门&#10;正文内容...&#10;&#10;第二章 试炼开启&#10;正文内容..."
                rows={10}
              />

              <div className="flex justify-end">
                <Button
                  onClick={handleImportTxt}
                  disabled={importing}
                  className="gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  开始智能分章并导入
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 左侧工具卡片矩阵 */}
            <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              {TOOLS.map((tool) => {
                const Icon = tool.icon
                const selected = activeTool?.id === tool.id
                return (
                  <Card
                    key={tool.id}
                    onClick={() => setActiveTool(tool)}
                    className={`cursor-pointer transition hover:border-indigo- ${
                      selected ? 'border-indigo- bg-indigo-600/5 shadow-sm' : ''
                    }`}
                  >
                    <CardHeader className="p-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Icon className="w-4 h-4 text-indigo-" />
                          {tool.title}
                        </CardTitle>
                        <Badge variant="secondary" className="text-[10px]">
                          {tool.badge}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs mt-1">{tool.desc}</CardDescription>
                    </CardHeader>
                  </Card>
                )
              })}
            </div>

            {/* 右侧工作区 */}
            <div className="lg:col-span-7">
              {activeTool && (
                <Card className="h-full flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <activeTool.icon className="w-5 h-5 text-indigo-" />
                      {activeTool.title}
                    </CardTitle>
                    <CardDescription>{activeTool.desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-4">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={activeTool.placeholder}
                      rows={5}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        onClick={handleRunAi}
                        disabled={loading}
                        className="gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        立即生成
                      </Button>
                    </div>

                    {output && (
                      <div className="flex-1 flex flex-col gap-2 rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>生成结果</span>
                          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={handleCopy}>
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            复制
                          </Button>
                        </div>
                        <div className="text-sm whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto">
                          {output}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
