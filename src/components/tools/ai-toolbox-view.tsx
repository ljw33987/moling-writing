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
  FileUp,
} from 'lucide-react'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import { PromptMarketPanel } from './prompt-market-panel'
import { MarkdownRenderer, markdownToPlainText } from '@/components/ai/markdown-renderer'

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

  // 整本拆书状态（支持百万字级 TXT / MD）
  const [bookFileName, setBookFileName] = useState('')
  const [bookChapters, setBookChapters] = useState<Array<{ title: string; content: string }>>([])
  const [deconstructMode, setDeconstructMode] = useState<'sample' | 'batch'>('sample')
  const [deconstructProgress, setDeconstructProgress] = useState('')

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

  function splitBookChapters(text: string): Array<{ title: string; content: string }> {
    const normalized = text.replace(/\r\n?/g, '\n')
    const regex = /(?:^|\n)[ \t　]*(第[零一二三四五六七八九十百千万0-9]{1,8}[章节回卷集].{0,40}|Chapter\s+\d+[^\n]{0,40})(?=\n|$)/gi
    const matches = Array.from(normalized.matchAll(regex))
    if (matches.length < 2) {
      // 按每 3000 字自动切片
      const chunks: Array<{ title: string; content: string }> = []
      for (let i = 0; i < normalized.length; i += 3000) {
        chunks.push({
          title: `第 ${chunks.length + 1} 段`,
          content: normalized.slice(i, i + 3000),
        })
      }
      return chunks
    }
    const chapters: Array<{ title: string; content: string }> = []
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index ?? 0
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? normalized.length) : normalized.length
      const title = matches[i][1].trim()
      const body = normalized.slice(start, end).trim()
      if (body.length > 30) {
        chapters.push({ title, content: body })
      }
    }
    return chapters
  }

  const handleDeconstructFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if ((text.match(/\uFFFD/g) || []).length > 5) {
      try {
        text = new TextDecoder('gbk', { fatal: false }).decode(buf)
      } catch {}
    }
    const chapters = splitBookChapters(text)
    setBookFileName(file.name)
    setBookChapters(chapters)
    setPrompt(text)
    toast.success(`已加载《${file.name}》：共 ${chapters.length} 章，约 ${(text.length / 10000).toFixed(1)} 万字`)
    e.target.value = ''
  }

  const handleRunAi = async () => {
    if (!activeTool || !prompt.trim()) {
      toast.error('请先填写输入内容，或上传整本小说 / 抓取网页')
      return
    }
    setLoading(true)
    setOutput('')
    setDeconstructProgress('')
    try {
      // 整本长文本拆书（超过 6000 字时启用采样或分批精拆）
      if (activeTool.id === 'deconstruct' && prompt.length > 6000) {
        const chapters = bookChapters.length > 0 ? bookChapters : splitBookChapters(prompt)
        if (deconstructMode === 'sample') {
          setDeconstructProgress('正在采样全书核心章节并生成拆书报告...')
          const picks: Array<{ title: string; content: string }> = []
          // 黄金前三章 + 中段均匀采样 + 末章
          picks.push(...chapters.slice(0, 3))
          if (chapters.length > 6) {
            const step = Math.floor((chapters.length - 4) / 4)
            for (let idx = 3; idx < chapters.length - 1 && picks.length < 7; idx += Math.max(1, step)) {
              picks.push(chapters[idx])
            }
          }
          if (chapters.length > 3) picks.push(chapters[chapters.length - 1])

          const sampleDigest = picks
            .map((c) => `【${c.title}】\n${c.content.slice(0, 1400)}`)
            .join('\n\n---\n\n')

          const r = await api<{ reply: string }>('/api/ai', {
            method: 'POST',
            body: JSON.stringify({
              action: 'chat',
              preset: 'deconstruct',
              message: `这是一本完整小说（《${bookFileName || '导入作品'}》，共 ${chapters.length} 章、约 ${(prompt.length / 10000).toFixed(1)} 万字）。以下是抽取的黄金开篇与全书代表章节，请进行系统性整本拆书分析（包含：核心卖点与题材定位、黄金三章钩子结构、主线升级节奏、核心人物塑造、爽点分布与可复用大纲模板）：\n\n${sampleDigest}`,
            }),
          })
          setOutput(r.reply || '')
          toast.success('整本快速脉络拆解完成')
        } else {
          // 分批精拆：百万字级长篇最多分 12 批覆盖全书前中后期，每批均匀抽样章节片段后汇总
          const maxBatches = prompt.length > 500000 ? 12 : 8
          const groupSize = Math.max(1, Math.ceil(chapters.length / maxBatches))
          const batches: Array<{ label: string; text: string }> = []
          for (let i = 0; i < chapters.length; i += groupSize) {
            const slice = chapters.slice(i, i + groupSize)
            const label = `${slice[0].title} ~ ${slice[slice.length - 1].title}`
            // 若该批次章节较多，均匀抽取最多 6 章代表片段，确保每阶段头尾都有覆盖
            const pickCount = Math.min(6, slice.length)
            const perCap = Math.floor(9000 / pickCount)
            const picked: typeof slice = []
            for (let k = 0; k < pickCount; k++) {
              const idx = pickCount === 1 ? 0 : Math.round((k * (slice.length - 1)) / (pickCount - 1))
              picked.push(slice[idx])
            }
            const joined = picked.map((c) => `【${c.title}】\n${c.content.slice(0, perCap)}`).join('\n\n')
            batches.push({ label, text: joined })
          }

          const summaries: string[] = []
          for (let b = 0; b < batches.length; b++) {
            setDeconstructProgress(`正在精拆第 ${b + 1} / ${batches.length} 阶段（${batches[b].label}）...`)
            const r = await api<{ reply: string }>('/api/ai', {
              method: 'POST',
              body: JSON.stringify({
                action: 'chat',
                message: `请作为资深网文主编，提炼以下小说阶段（${batches[b].label}）的核心剧情推进、出场关键角色、金手指/实力变化、爽点设计与埋下的伏笔（300字以内，条理清晰）：\n\n${batches[b].text}`,
              }),
            })
            summaries.push(`### 阶段 ${b + 1}：${batches[b].label}\n${r.reply}`)
          }

          setDeconstructProgress('正在汇总全书阶段摘要，生成完整拆书总报告...')
          const finalRes = await api<{ reply: string }>('/api/ai', {
            method: 'POST',
            body: JSON.stringify({
              action: 'chat',
              preset: 'deconstruct',
              message: `以下是小说《${bookFileName || '导入作品'}》（共 ${chapters.length} 章、约 ${(prompt.length / 10000).toFixed(1)} 万字）全书各阶段的拆解摘要，请综合输出一份完整的「整本拆书总报告」（涵盖核心卖点、全书结构、节奏曲线、人物弧光与可复用仿写大纲）：\n\n${summaries.join('\n\n')}`,
            }),
          })
          setOutput(`${finalRes.reply}\n\n---\n\n## 各阶段拆解明细\n\n${summaries.join('\n\n')}`)
          toast.success('全书分批深度精拆完成')
        }
        return
      }

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
      setDeconstructProgress('')
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* 页头 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-display flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-gold" />
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
              className={mode === 'ai' ? 'bg-primary rounded-full shadow-sm' : ''}
              onClick={() => setMode('ai')}
            >
              AI 生成与拆书
            </Button>
            <Button
              variant={mode === 'market' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'market' ? 'bg-primary rounded-full shadow-sm gap-1.5' : 'gap-1.5'}
              onClick={() => setMode('market')}
            >
              <Store className="w-3.5 h-3.5" />
              提示词模板市场
            </Button>
            <Button
              variant={mode === 'txt' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'txt' ? 'bg-primary rounded-full shadow-sm gap-1.5' : 'gap-1.5'}
              onClick={() => setMode('txt')}
            >
              <Upload className="w-3.5 h-3.5" />
              TXT 智能分章导入
            </Button>
            <Button
              variant={mode === 'cover' ? 'default' : 'outline'}
              size="sm"
              className={mode === 'cover' ? 'bg-primary rounded-full shadow-sm gap-1.5' : 'gap-1.5'}
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
              <CardTitle className="text-lg font-display">原创小说封面生成器（无版权风险）</CardTitle>
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
                    className="gap-1.5 bg-primary rounded-full shadow-sm hover:bg-primary/90"
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
              <CardTitle className="text-lg font-display">TXT 长文本智能分章导入</CardTitle>
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
                  className="gap-1.5 bg-primary rounded-full shadow-sm hover:bg-primary/90"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  开始智能分章并导入
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* 左侧紧凑工具导航栏 */}
            <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
              {TOOLS.map((tool) => {
                const selected = activeTool?.id === tool.id
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      setActiveTool(tool)
                      setOutput('')
                    }}
                    className={`w-full text-left rounded-[14px] border p-2.5 flex items-center gap-3 transition-all bg-card hover:border-[var(--brand-line)] hover:shadow-sm ${
                      selected
                        ? 'border-primary/60 bg-primary/8 shadow-xs ring-1 ring-primary/20'
                        : 'border-border bg-card hover:bg-muted/50 hover:border-primary/30'
                    }`}
                  >
                    <img
                      src={tool.image}
                      alt={tool.title}
                      className="w-10 h-10 rounded-lg shadow-2xs shrink-0 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-semibold truncate ${selected ? 'text-primary' : 'text-foreground'}`}>
                          {tool.title}
                        </span>
                        <Badge variant={selected ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 shrink-0">
                          {tool.badge}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{tool.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 右侧创作工作台 */}
            <div className="lg:col-span-8">
              {activeTool && (
                <Card className="shadow-xs border-border/80">
                  <CardHeader className="pb-4 border-b border-border/60 flex flex-row items-center justify-between gap-4 space-y-0">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <img
                        src={activeTool.image}
                        alt={activeTool.title}
                        className="w-11 h-11 rounded-xl shadow-xs shrink-0 object-cover"
                      />
                      <div className="min-w-0">
                        <CardTitle className="text-base sm:text-lg font-display flex items-center gap-2">
                          <span>{activeTool.title}</span>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {activeTool.badge}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5 truncate">{activeTool.desc}</CardDescription>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setPrompt(activeTool.placeholder.replace(/^例：/, ''))}
                    >
                      填入示例
                    </Button>
                  </CardHeader>

                  <CardContent className="p-5 space-y-4">
                    {/* 拆书专属：整本上传（支持百万字级） */}
                    {activeTool.id === 'deconstruct' && (
                      <div className="rounded-xl border border-border bg-[var(--surface-2)] p-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[9px] border border-border bg-card hover:bg-muted text-xs font-medium cursor-pointer transition-colors">
                            <FileUp className="w-3.5 h-3.5 text-primary" />
                            <span>上传整本 TXT / MD</span>
                            <input
                              type="file"
                              accept=".txt,.md,text/plain"
                              onChange={handleDeconstructFile}
                              className="hidden"
                            />
                          </label>
                          <span className="text-[11px] text-muted-foreground">
                            支持百万字级整本小说（自动识别 UTF-8 / GBK 编码并智能分章）
                          </span>
                        </div>

                        {(bookFileName || prompt.length > 6000) && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs">
                            <span className="text-muted-foreground">
                              {bookFileName ? `已加载「${bookFileName}」` : '长文本模式'}
                              {bookChapters.length > 0 && ` · 共 ${bookChapters.length} 章`}
                              {` · 约 ${(prompt.length / 10000).toFixed(1)} 万字`}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDeconstructMode('sample')}
                                className={`h-6 px-2.5 rounded-[7px] text-[11px] font-medium border transition-colors ${
                                  deconstructMode === 'sample'
                                    ? 'bg-[var(--brand-soft)] text-[var(--brand-ink)] border-[var(--brand-line)]'
                                    : 'bg-card text-muted-foreground border-border'
                                }`}
                              >
                                快速脉络拆解（省额度）
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeconstructMode('batch')}
                                className={`h-6 px-2.5 rounded-[7px] text-[11px] font-medium border transition-colors ${
                                  deconstructMode === 'batch'
                                    ? 'bg-[var(--brand-soft)] text-[var(--brand-ink)] border-[var(--brand-line)]'
                                    : 'bg-card text-muted-foreground border-border'
                                }`}
                              >
                                全书分批精拆（更深度）
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Textarea
                        value={prompt.length > 30000 ? `${prompt.slice(0, 12000)}\n\n...（完整文本共 ${prompt.length.toLocaleString()} 字，已加载至内存，点击「立即生成」将按整本模式拆解）...` : prompt}
                        onChange={(e) => {
                          setPrompt(e.target.value)
                          if (!e.target.value) {
                            setBookFileName('')
                            setBookChapters([])
                          }
                        }}
                        placeholder={activeTool.placeholder}
                        rows={6}
                        className="resize-y text-sm leading-relaxed"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          已输入 {prompt.length.toLocaleString()} 字
                          {deconstructProgress && (
                            <span className="ml-2 text-primary font-medium">{deconstructProgress}</span>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          {prompt && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-muted-foreground"
                              onClick={() => {
                                setPrompt('')
                                setOutput('')
                                setBookFileName('')
                                setBookChapters([])
                              }}
                            >
                              清空
                            </Button>
                          )}
                          <Button
                            onClick={handleRunAi}
                            disabled={loading}
                            size="sm"
                            className="h-8 px-4 gap-1.5 bg-primary rounded-full shadow-sm hover:bg-primary/90 text-primary-foreground"
                          >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {loading ? '正在生成...' : '立即生成'}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* 结构化结果区 */}
                    <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-border/60 bg-muted/30 flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">AI 生成结果</span>
                        {output && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs gap-1"
                            onClick={() => {
                              navigator.clipboard.writeText(markdownToPlainText(output))
                              setCopied(true)
                              toast.success('已复制纯文本')
                              setTimeout(() => setCopied(false), 1500)
                            }}
                          >
                            {copied ? <Check className="w-3 h-3 text-jade" /> : <Copy className="w-3 h-3" />}
                            复制结果
                          </Button>
                        )}
                      </div>
                      <div className="p-4 min-h-[220px] max-h-[460px] overflow-y-auto">
                        {loading ? (
                          <div className="h-[180px] flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                            <Loader2 className="w-5 h-5 animate-spin text-gold" />
                            <span>AI 正在深度构思中，请稍候...</span>
                          </div>
                        ) : output ? (
                          <MarkdownRenderer content={output} />
                        ) : (
                          <div className="h-[180px] flex flex-col items-center justify-center text-center text-muted-foreground gap-1.5">
                            <Sparkles className="w-5 h-5 opacity-40" />
                            <p className="text-xs">输入灵感或点击右上角「填入示例」，生成结果将在此处以结构化排版呈现</p>
                          </div>
                        )}
                      </div>
                    </div>
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
