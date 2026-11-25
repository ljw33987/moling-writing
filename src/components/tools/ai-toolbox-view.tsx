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
  Image as ImageIcon,
  Download,
  Store,
} from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import { PromptMarketPanel } from './prompt-market-panel'

interface ToolDef {
  id: string
  preset: string
  title: string
  badge: string
  desc: string
  placeholder: string
  icon: any
  image: string
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
    image: '/toolbox/tool-synopsis.svg',
  },
  {
    id: 'goldfinger',
    preset: 'goldfinger',
    title: '金手指 / 脑洞生成',
    badge: '策划',
    desc: '设计 3 套有爽点、有成长上限、带首个高潮兑现的金手指方案',
    placeholder: '例：都市修仙 / 历史种田 / 系统流，希望主角前期低调发育、打脸爽感强…',
    icon: Zap,
    image: '/toolbox/tool-goldfinger.svg',
  },
  {
    id: 'golden_three',
    preset: 'golden_three',
    title: '黄金三章开篇',
    badge: '正文',
    desc: '专攻前三章“三秒抓眼球”高能开局，快速立住矛盾与金手指',
    placeholder: '填写主角身份、开局困境、金手指触发契机及前三章核心事件…',
    icon: Flame,
    image: '/toolbox/tool-golden3.svg',
  },
  {
    id: 'name_gen',
    preset: 'name_gen',
    title: '网文起名器',
    badge: '高频',
    desc: '批量生成角色名、宗门、功法、法宝、势力名并附风格说明',
    placeholder: '例：生成 10 个仙侠剑修宗门名与镇派剑诀名，要求偏冷冽孤高风格',
    icon: Wand2,
    image: '/toolbox/tool-naming.svg',
  },
  {
    id: 'char_dialogue',
    preset: 'char_dialogue',
    title: '精彩冲突对话',
    badge: '正文',
    desc: '输入两个角色性格与矛盾点，生成有张力的多轮对白',
    placeholder: '例：冷面师姐（柳清霜）质问隐忍杂役（沈默）为何偷学禁地剑意，表面问责实则试探…',
    icon: MessageSquare,
    image: '/toolbox/tool-dialogue.svg',
  },
  {
    id: 'break_block',
    preset: 'break_block',
    title: '卡文破局思路',
    badge: '辅助',
    desc: '写到一半卡住？快速给出 3 种不同方向的反转与推进方案',
    placeholder: '描述你当前卡住的剧情节点，以及希望保持的基调…',
    icon: Compass,
    image: '/toolbox/tool-break.svg',
  },
  {
    id: 'deconstruct',
    preset: 'deconstruct',
    title: '拆书分析（样章拆解）',
    badge: '拆书',
    desc: '粘贴爆款小说章节，拆解开篇钩子、情绪节奏、爽点与可复用章纲模板',
    placeholder: '请粘贴 500~4000 字的对标样章正文…',
    icon: FileSearch,
    image: '/toolbox/tool-deconstruct.svg',
  },
  {
    id: 'editor_review',
    preset: 'editor_review',
    title: '网文编辑审稿评分',
    badge: '审稿',
    desc: '模拟起点/番茄资深编辑，从逻辑、人设、节奏、爽点多维打分并给修改建议',
    placeholder: '请粘贴待审稿的章节正文（建议 1000~3500 字）…',
    icon: Award,
    image: '/toolbox/tool-review.svg',
  },
]

export function AiToolboxView() {
  const [activeTool, setActiveTool] = useState<ToolDef | null>(TOOLS[0])
  const [mode, setMode] = useState<'ai' | 'market' | 'txt' | 'cover'>('ai')
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // 原创封面生成器状态
  const [coverTitle, setCoverTitle] = useState('太虚问道')
  const [coverAuthor, setCoverAuthor] = useState('青云客')
  const [coverTagline, setCoverTagline] = useState('一剑破苍穹 · 万古第一宗')
  const [coverTheme, setCoverTheme] = useState<'xianxia' | 'urban' | 'scifi' | 'history' | 'romance'>('xianxia')

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
              variant={mode === 'market' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'market' ? 'bg-gradient-to-r from-indigo-600 to-blue-600 gap-1.5' : 'gap-1.5'}
              onClick={() => setMode('market')}
            >
              <Store className="w-3.5 h-3.5" />
              提示词模板市场
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
            <Button
              variant={mode === 'cover' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'cover' ? 'bg-gradient-to-r from-indigo-600 to-blue-600 gap-1.5' : 'gap-1.5'}
              onClick={() => setMode('cover')}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              原创封面生成
            </Button>
          </div>
        </div>

        {mode === 'market' ? (
          <PromptMarketPanel
            onApplyPrompt={(text) => {
              setPrompt(text)
              setActiveTool(TOOLS[0])
              setMode('ai')
            }}
          />
        ) : mode === 'cover' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">原创小说封面生成器（无版权风险）</CardTitle>
              <CardDescription>
                输入书名、笔名与宣传语，实时生成 3:4 竖版原创封面图，支持直接下载 PNG 或一键应用到作品
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>作品书名</Label>
                  <Input value={coverTitle} onChange={(e) => setCoverTitle(e.target.value)} placeholder="输入书名" />
                </div>
                <div className="space-y-1.5">
                  <Label>作者笔名</Label>
                  <Input value={coverAuthor} onChange={(e) => setCoverAuthor(e.target.value)} placeholder="输入笔名" />
                </div>
                <div className="space-y-1.5">
                  <Label>封面金句 / 副标题</Label>
                  <Input value={coverTagline} onChange={(e) => setCoverTagline(e.target.value)} placeholder="一句话卖点" />
                </div>
                <div className="space-y-1.5">
                  <Label>视觉风格</Label>
                  <Select value={coverTheme} onValueChange={(v) => setCoverTheme(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xianxia">玄墨剑影（玄幻/仙侠）</SelectItem>
                      <SelectItem value="urban">霓虹夜色（都市/异能）</SelectItem>
                      <SelectItem value="scifi">深空星舰（科幻/未来）</SelectItem>
                      <SelectItem value="history">朱砂古卷（历史/武侠）</SelectItem>
                      <SelectItem value="romance">暖雪柔光（言情/治愈）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    className="gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-90"
                    onClick={() => {
                      const svg = document.getElementById('bifeng-cover-svg')
                      if (!svg) return
                      const xml = new XMLSerializer().serializeToString(svg)
                      const img = new window.Image()
                      img.onload = () => {
                        const canvas = document.createElement('canvas')
                        canvas.width = 600
                        canvas.height = 800
                        const ctx = canvas.getContext('2d')
                        if (!ctx) return
                        ctx.drawImage(img, 0, 0, 600, 800)
                        const a = document.createElement('a')
                        a.download = `${coverTitle || 'cover'}.png`
                        a.href = canvas.toDataURL('image/png')
                        a.click()
                        toast.success('已导出原创 PNG 封面')
                      }
                      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
                    }}
                  >
                    <Download className="w-4 h-4" />
                    下载 PNG 封面 (600×800)
                  </Button>
                </div>
              </div>

              <div className="flex justify-center">
                <svg
                  id="bifeng-cover-svg"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 300 400"
                  className="w-64 aspect-[3/4] rounded-xl shadow-lg border border-border"
                >
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="300" y2="400" gradientUnits="userSpaceOnUse">
                      <stop
                        offset="0%"
                        stopColor={
                          coverTheme === 'xianxia'
                            ? '#0f172a'
                            : coverTheme === 'urban'
                            ? '#1e1b4b'
                            : coverTheme === 'scifi'
                            ? '#090d16'
                            : coverTheme === 'history'
                            ? '#271712'
                            : '#3b1d2e'
                        }
                      />
                      <stop
                        offset="100%"
                        stopColor={
                          coverTheme === 'xianxia'
                            ? '#1e3a8a'
                            : coverTheme === 'urban'
                            ? '#0369a1'
                            : coverTheme === 'scifi'
                            ? '#1e293b'
                            : coverTheme === 'history'
                            ? '#7c2d12'
                            : '#831843'
                        }
                      />
                    </linearGradient>
                  </defs>
                  <rect width="300" height="400" fill="url(#cg)" />
                  <circle cx="240" cy="80" r="90" fill="#ffffff" opacity="0.06" />
                  <circle cx="60" cy="340" r="110" fill="#f59e0b" opacity="0.08" />
                  <rect x="16" y="16" width="268" height="368" fill="none" stroke="#f59e0b" strokeOpacity="0.45" strokeWidth="1.5" rx="8" />
                  <text x="150" y="62" textAnchor="middle" fill="#fbbf24" fontSize="11" letterSpacing="4">
                    笔锋写作 · 原创典藏
                  </text>
                  <text x="150" y="178" textAnchor="middle" fill="#ffffff" fontSize="28" fontWeight="bold" fontFamily="serif">
                    {(coverTitle || '未命名作品').slice(0, 8)}
                  </text>
                  {coverTitle.length > 8 && (
                    <text x="150" y="216" textAnchor="middle" fill="#ffffff" fontSize="22" fontWeight="bold" fontFamily="serif">
                      {coverTitle.slice(8, 18)}
                    </text>
                  )}
                  <line x1="90" y1="242" x2="210" y2="242" stroke="#fbbf24" strokeOpacity="0.6" strokeWidth="1" />
                  <text x="150" y="268" textAnchor="middle" fill="#e2e8f0" fontSize="12" opacity="0.9">
                    {coverTagline || ' '}
                  </text>
                  <text x="150" y="348" textAnchor="middle" fill="#cbd5e1" fontSize="14" letterSpacing="2">
                    {coverAuthor || '佚名'} 著
                  </text>
                </svg>
              </div>
            </CardContent>
          </Card>
        ) : mode === 'txt' ? (
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
                const selected = activeTool?.id === tool.id
                return (
                  <Card
                    key={tool.id}
                    onClick={() => setActiveTool(tool)}
                    className={`cursor-pointer transition hover:border-indigo-400 ${
                      selected ? 'border-indigo-600 bg-indigo-600/5 shadow-sm' : ''
                    }`}
                  >
                    <CardHeader className="p-3.5 flex flex-row items-center gap-3.5 space-y-0">
                      <img
                        src={tool.image}
                        alt={tool.title}
                        className="w-14 h-14 rounded-xl shadow-sm shrink-0 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm truncate">{tool.title}</CardTitle>
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {tool.badge}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs mt-1 line-clamp-2">{tool.desc}</CardDescription>
                      </div>
                    </CardHeader>
                  </Card>
                )
              })}
            </div>

            {/* 右侧工作区 */}
            <div className="lg:col-span-7">
              {activeTool && (
                <Card className="h-full flex flex-col">
                  <CardHeader className="flex flex-row items-center gap-4 space-y-0">
                    <img
                      src={activeTool.image}
                      alt={activeTool.title}
                      className="w-12 h-12 rounded-xl shadow-sm shrink-0 object-cover"
                    />
                    <div>
                      <CardTitle className="text-lg">{activeTool.title}</CardTitle>
                      <CardDescription>{activeTool.desc}</CardDescription>
                    </div>
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
