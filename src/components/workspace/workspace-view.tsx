'use client'

import { useEffect, useState, useCallback } from 'react'
import { api, formatWords, formatTime, FOLDER_COLORS, GENRES } from '@/lib/helpers'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Folder as FolderIcon,
  FolderPlus,
  BookOpen,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Sparkles,
  Calendar,
  TrendingUp,
  Library,
  FileText,
  ChevronRight,
  Loader2,
  Wand2,
  RotateCcw,
  Search,
  LayoutGrid,
  List as ListIcon,
  PenLine,
  Compass,
  House,
  Settings,
  Layers,
  Upload,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { NovelWizard } from './novel-wizard'

interface Folder {
  id: string
  name: string
  color: string
  sortOrder: number
  parentId: string | null
  children?: Folder[]
  novels?: { id: string; totalWords: number }[]
  novelCount: number
  totalWords: number
}

interface Novel {
  id: string
  title: string
  cover: string | null
  author: string | null
  genre: string
  tags: string
  synopsis: string | null
  status: string
  totalWords: number
  updatedAt: string
  folderId: string | null
}

interface ResumeDetails {
  id: string
  volumes: { chapters: { id: string; title: string; updatedAt: string }[] }[]
  autoSerials: { enabled: boolean }[]
}

interface UserStats {
  user: { name: string | null; penName: string | null; tokens: number; plan: string }
  stats: {
    todayWords: number
    totalWords: number
    novelCount: number
    heatmap: { date: string; words: number }[]
  }
}

export function WorkspaceView() {
  const { openNovel, setCurrentChapter, setCurrentFolder, setView } = useAppStore()
  const [folders, setFolders] = useState<Folder[]>([])
  const [novels, setNovels] = useState<Novel[]>([])
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderColor, setNewFolderColor] = useState('slate')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ongoing' | 'completed' | 'paused'>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'words'>('updated')
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid')
  const [importOpen, setImportOpen] = useState(false)
  const [importTitle, setImportTitle] = useState('')
  const [importContent, setImportContent] = useState('')
  const [importing, setImporting] = useState(false)

  const handleImportTxt = async () => {
    if (!importContent.trim()) {
      toast.error('请先选择 TXT 文件或粘贴内容')
      return
    }
    setImporting(true)
    try {
      const r = await api<{ novel: { id: string } }>('/api/novels/import-txt', {
        method: 'POST',
        body: JSON.stringify({
          title: importTitle.trim() || undefined,
          content: importContent,
          folderId: selectedFolder || undefined,
        }),
      })
      toast.success('TXT 导入成功')
      setImportOpen(false)
      setImportTitle('')
      setImportContent('')
      loadNovels()
      loadStats()
      loadFolders()
      openNovel(r.novel.id)
    } catch (e: any) {
      toast.error(e.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const loadFolders = useCallback(async () => {
    try {
      const r = await api<{ folders: Folder[] }>('/api/folders')
      setFolders(r.folders)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const loadNovels = useCallback(async () => {
    try {
      const params: any = {}
      if (selectedFolder) params.folderId = selectedFolder
      const r = await api<{ novels: Novel[] }>('/api/novels', { params })
      setNovels(r.novels)
    } catch (e) {
      console.error(e)
    }
  }, [selectedFolder])

  const loadStats = useCallback(async () => {
    try {
      const r = await api<UserStats>('/api/user')
      setStats(r)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([loadFolders(), loadNovels(), loadStats()]).finally(() => setLoading(false))
  }, [loadFolders, loadNovels, loadStats])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNovels()
  }, [selectedFolder, loadNovels])

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('请输入文件夹名称')
      return
    }
    try {
      await api('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: newFolderName, color: newFolderColor }),
      })
      toast.success('文件夹已创建')
      setNewFolderName('')
      setNewFolderOpen(false)
      loadFolders()
    } catch (e: any) {
      toast.error(e.message || '创建失败')
    }
  }

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('删除文件夹后，其中的小说将变为"未分类"。确认删除？')) return
    try {
      await api(`/api/folders?id=${id}`, { method: 'DELETE' })
      toast.success('已删除')
      loadFolders()
      loadNovels()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleRenameFolder = async (folder: Folder) => {
    const name = prompt('新文件夹名称', folder.name)
    if (!name || name === folder.name) return
    try {
      await api('/api/folders', {
        method: 'PATCH',
        body: JSON.stringify({ id: folder.id, name }),
      })
      loadFolders()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDeleteNovel = async (id: string) => {
    if (!confirm('确认删除这本小说？将移入回收站，30 天内可恢复。')) return
    try {
      await api(`/api/novels?id=${id}`, { method: 'DELETE' })
      toast.success('已移入回收站')
      loadNovels()
      loadStats()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // 回收站
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashNovels, setTrashNovels] = useState<any[]>([])
  const [trashLoading, setTrashLoading] = useState(false)

  const loadTrash = async () => {
    setTrashLoading(true)
    try {
      const r = await api<{ novels: any[] }>('/api/novels?trash=true')
      setTrashNovels(r.novels)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTrashLoading(false)
    }
  }

  const handleRestore = async (id: string) => {
    try {
      await api(`/api/novels?id=${id}&restore=true`, { method: 'PATCH' })
      toast.success('已从回收站恢复')
      loadTrash()
      loadNovels()
      loadStats()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handlePurge = async (id: string, title: string) => {
    if (!confirm(`确认永久删除「${title}」？此操作不可恢复！`)) return
    try {
      await api(`/api/novels?id=${id}&purge=true`, { method: 'DELETE' })
      toast.success('已永久删除')
      loadTrash()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  // 生成最近 35 天热力图
  const heatmapData = (() => {
    const days: { date: string; words: number }[] = []
    const map = new Map(stats?.stats.heatmap.map((h) => [h.date, h.words]) || [])
    for (let i = 34; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      days.push({ date: dateStr, words: map.get(dateStr) || 0 })
    }
    return days
  })()

  const recentNovel = novels.length > 0
    ? [...novels].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    : null

  const [resumeDetails, setResumeDetails] = useState<ResumeDetails | null>(null)
  const recentNovelId = recentNovel?.id
  useEffect(() => {
    if (!recentNovelId) return
    let cancelled = false
    api<{ novel: ResumeDetails }>(`/api/novels?id=${encodeURIComponent(recentNovelId)}`)
      .then(({ novel }) => {
        if (!cancelled) setResumeDetails(novel)
      })
      .catch(() => {
        if (!cancelled) setResumeDetails(null)
      })
    return () => { cancelled = true }
  }, [recentNovelId])
  const details = resumeDetails?.id === recentNovelId ? resumeDetails : null
  const recentChapters = (details?.volumes.flatMap((volume) => volume.chapters) ?? [])
    .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))
    .slice(0, 4)

  function resumeWriting(chapterId = recentChapters[0]?.id) {
    if (!recentNovel) return
    setCurrentFolder(recentNovel.folderId)
    openNovel(recentNovel.id)
    if (chapterId) setCurrentChapter(chapterId)
  }

  const filteredNovels = novels
    .filter((n) => {
      if (statusFilter !== 'all' && n.status !== statusFilter) return false
      const q = searchQuery.trim().toLowerCase()
      if (!q) return true
      return (
        n.title.toLowerCase().includes(q) ||
        n.genre.toLowerCase().includes(q) ||
        (n.synopsis && n.synopsis.toLowerCase().includes(q))
      )
    })
    .sort((a, b) => {
      if (sortBy === 'words') return b.totalWords - a.totalWords
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

  const dailyGoal = 3000
  const todayWords = stats?.stats.todayWords || 0
  const dailyPct = Math.min(100, Math.round((todayWords / dailyGoal) * 100))

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="workspace-root flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="studio-workspace-layout">
        <div id="workspace-overview" className="studio-workspace-main">
        {recentNovel && (
          <Card className="studio-resume">
            <CardContent className="studio-resume-content">
              <div className="studio-resume-book">
                <div className="studio-resume-cover">
                  {recentNovel.cover ? (
                    <img src={recentNovel.cover} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="font-bold">{recentNovel.title.slice(0, 2)}</span>
                  )}
                </div>
                <div className="studio-resume-copy">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                      最近编辑
                    </Badge>
                    <span className="studio-resume-title font-display break-words">{recentNovel.title}</span>
                    <Badge variant="secondary" className="text-[10px]">{recentNovel.genre}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {recentNovel.synopsis || '暂无简介'}
                  </p>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                    <span>{formatWords(recentNovel.totalWords)} 字</span>
                    <span>更新于 {formatTime(recentNovel.updatedAt)}</span>
                  </div>
                  <div className="pt-3 text-xs text-muted-foreground">
                    <label htmlFor="resume-word-goal">今日字数 {todayWords.toLocaleString()} / {dailyGoal.toLocaleString()}</label>
                    <progress id="resume-word-goal" className="studio-progress" value={dailyPct} max={100} />
                  </div>
                  {recentChapters[0] && <p className="text-sm">当前章节 · {recentChapters[0].title}</p>}
                  <Button
                    className="w-full gap-2"
                    onClick={() => resumeWriting()}
                  >
                    <PenLine className="w-4 h-4" />继续写作
                  </Button>
                </div>
              </div>
              <aside className="studio-resume-activity">
                <section>
                  <h2><Sparkles />自动连载</h2>
                  <p>{!details ? '状态暂不可用' : details.autoSerials.some((task) => task.enabled) ? '已开启' : '未开启'}</p>
                </section>
                <section>
                  <h2>最近章节</h2>
                  {recentChapters.length > 0 ? (
                    <ul>{recentChapters.map((chapter) => (
                      <li key={chapter.id}>
                        <button type="button" onClick={() => resumeWriting(chapter.id)}>
                          <span>{chapter.title}</span><time dateTime={chapter.updatedAt}>{formatTime(chapter.updatedAt)}</time>
                        </button>
                      </li>
                    ))}</ul>
                  ) : <p>{details ? '还没有章节' : '暂无章节记录'}</p>}
                </section>
              </aside>
            </CardContent>
          </Card>
        )}

        {/* 文件夹 + 小说卡片 */}
        <section id="workspace-books" className="studio-bookshelf">
          <header>
            <h2 className="font-display"><BookOpen />我的作品</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload />导入</Button>
              <Button size="sm" onClick={() => setWizardOpen(true)}><Plus />新建作品</Button>
            </div>
          </header>
          <div className="studio-bookshelf-body">
          {/* 文件夹侧栏 */}
          <details className="workspace-folders space-y-2">
            <summary className="cursor-pointer text-sm font-medium">文件夹与回收站</summary>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Library className="w-4 h-4" />
                文件夹
              </h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setNewFolderOpen(true)}>
                <FolderPlus className="w-4 h-4" />
              </Button>
            </div>

            <button
              onClick={() => setSelectedFolder(null)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition ${!selectedFolder ? 'bg-secondary' : 'hover:bg-muted'
                }`}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                全部作品
              </span>
              <Badge variant="secondary" className="text-xs">
                {stats?.stats.novelCount || 0}
              </Badge>
            </button>

            {folders.map((f) => (
              <div key={f.id} className="group">
                <button
                  onClick={() => setSelectedFolder(f.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition ${selectedFolder === f.id ? 'bg-secondary' : 'hover:bg-muted'
                    }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className={`w-2.5 h-2.5 rounded-full ${FOLDER_COLORS[f.color] || 'bg-slate-500'}`} />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge variant="outline" className="text-xs">
                      {f.novelCount}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleRenameFolder(f)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" />
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => handleDeleteFolder(f.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </button>
                {f.totalWords > 0 && (
                  <div className="text-xs text-muted-foreground pl-8 py-0.5">
                    {formatWords(f.totalWords)} 字
                  </div>
                )}
              </div>
            ))}

            {folders.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4 px-3 border border-dashed rounded-md">
                还没有文件夹
                <br />
                点击右上角 + 创建
              </div>
            )}

            {/* 回收站入口 */}
            <button
              onClick={() => { setTrashOpen(true); loadTrash() }}
              className="w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-muted transition text-muted-foreground"
            >
              <Trash2 className="w-4 h-4" />
              回收站
            </button>
          </details>

          {/* 小说卡片网格 / 列表 */}
          <div className="min-w-0 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="font-semibold flex items-center gap-2">
                <span>
                  {selectedFolder
                    ? folders.find((f) => f.id === selectedFolder)?.name || '作品'
                    : '全部作品'}
                </span>
                <span className="text-muted-foreground font-normal text-sm">({filteredNovels.length})</span>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-44 sm:w-52">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索作品或题材..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <div className="flex items-center border rounded-md p-0.5 bg-muted/40">
                  {([
                    { id: 'all', label: '全部' },
                    { id: 'ongoing', label: '连载' },
                    { id: 'completed', label: '完结' },
                    { id: 'paused', label: '暂停' },
                  ] as const).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStatusFilter(st.id)}
                      className={`px-2 py-1 text-xs rounded transition ${statusFilter === st.id
                          ? 'bg-background shadow-sm font-medium'
                          : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'updated' | 'words')}>
                  <SelectTrigger className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated" className="text-xs">最近更新</SelectItem>
                    <SelectItem value="words" className="text-xs">字数最多</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center border rounded-md p-0.5 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setLayoutMode('grid')}
                    className={`p-1 rounded ${layoutMode === 'grid' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                    title="卡片视图"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayoutMode('list')}
                    className={`p-1 rounded ${layoutMode === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                    title="列表视图"
                  >
                    <ListIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Button size="sm" onClick={() => setWizardOpen(true)} className="gap-1.5 h-8">
                  <Plus className="w-3.5 h-3.5" />
                  创建新书
                </Button>
              </div>
            </div>

            {filteredNovels.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/15 to-gold/15 flex items-center justify-center mb-4">
                    <Wand2 className="w-8 h-8 text-primary" />
                  </div>
                  <h4 className="font-semibold mb-1">
                    {novels.length === 0 ? '开始你的第一部作品' : '没有匹配的作品'}
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4 max-w-md">
                    {novels.length === 0
                      ? '只需要一句话灵感，AI 帮你生成简介、大纲、核心角色，3 秒开启创作之旅'
                      : '尝试清空搜索关键词或切换筛选状态'}
                  </p>
                  {novels.length === 0 && (
                    <Button onClick={() => setWizardOpen(true)} className="gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      AI 辅助建书
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : layoutMode === 'grid' ? (
              <div className="studio-novel-grid">
                {filteredNovels.map((n) => (
                  <NovelCard
                    key={n.id}
                    novel={n}
                    onOpen={() => {
                      setCurrentFolder(n.folderId)
                      openNovel(n.id)
                    }}
                    onDelete={() => handleDeleteNovel(n.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredNovels.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      setCurrentFolder(n.folderId)
                      openNovel(n.id)
                    }}
                    className="group flex items-center justify-between gap-4 p-3.5 border rounded-lg bg-card hover:shadow-sm hover:border-primary/40 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-12 rounded bg-gradient-to-br from-primary/15 to-gold/10 border border-border/60 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary/80">{n.title.slice(0, 2)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{n.title}</span>
                          <Badge variant="secondary" className="text-[10px]">{n.genre}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate max-w-xl mt-0.5">
                          {n.synopsis || '暂无简介'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
                      <span>{formatWords(n.totalWords)} 字</span>
                      <span className="hidden sm:inline">{formatTime(n.updatedAt)}</span>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                        进入写作
                        <ChevronRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </section>

        {/* 数据看板 */}
        <div id="workspace-stats" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-primary/10 to-jade/10 border-primary/25">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">今日新增</CardTitle>
              <TrendingUp className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">
                {formatWords(todayWords)}
                <span className="text-sm font-normal text-muted-foreground ml-1">字</span>
              </div>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-jade rounded-full transition-all"
                    style={{ width: `${dailyPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  日更目标 {formatWords(dailyGoal)} 字 · 已完成 {dailyPct}%
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">总字数</CardTitle>
              <FileText className="w-4 h-4 text-jade" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">
                {formatWords(stats?.stats.totalWords || 0)}
                <span className="text-sm font-normal text-muted-foreground ml-1">字</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">累计创作字数</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">作品总数</CardTitle>
              <BookOpen className="w-4 h-4 text-gold" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">{stats?.stats.novelCount || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">本创作资产</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Token 余额</CardTitle>
              <Sparkles className="w-4 h-4 text-cinnabar" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono font-display">
                {(stats?.user.tokens || 0).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.user.plan === 'pro' ? '月卡会员' : stats?.user.plan === 'year' ? '年卡会员' : '免费用户'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 创作日历热力图 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              近期创作日历
            </CardTitle>
            <span className="text-xs text-muted-foreground">连续码字，养成习惯</span>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1 flex-wrap">
              {heatmapData.map((d) => {
                const intensity = Math.min(4, Math.floor(d.words / 1000))
                const colors = [
                  'bg-muted',
                  'bg-jade/25',
                  'bg-jade/50',
                  'bg-jade/75',
                  'bg-jade',
                ]
                return (
                  <div
                    key={d.date}
                    title={`${d.date}：${d.words} 字`}
                    className={`w-4 h-4 rounded-[3px] ${colors[intensity]} hover:ring-2 hover:ring-jade/40 transition`}
                  />
                )
              })}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <span>少</span>
              <div className="w-3 h-3 rounded-[3px] bg-muted" />
              <div className="w-3 h-3 rounded-[3px] bg-jade/25" />
              <div className="w-3 h-3 rounded-[3px] bg-jade/50" />
              <div className="w-3 h-3 rounded-[3px] bg-jade/75" />
              <div className="w-3 h-3 rounded-[3px] bg-jade" />
              <span>多</span>
              <span className="ml-auto">
                本月共 {heatmapData.slice(-30).reduce((s, d) => s + d.words, 0)} 字
              </span>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>

      {/* 新建文件夹 */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="如：进行中 / 已完结 / 短篇练习"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
            </div>
            <div className="space-y-2">
              <Label>颜色标签</Label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(FOLDER_COLORS).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setNewFolderColor(k)}
                    className={`w-7 h-7 rounded-full ${v} ${newFolderColor === k ? 'ring-2 ring-offset-2 ring-foreground' : ''
                      }`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 创建小说向导 */}
      <NovelWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        folderId={selectedFolder}
        onCreated={(id) => {
          setWizardOpen(false)
          loadNovels()
          loadStats()
          loadFolders()
          openNovel(id)
        }}
      />

      {/* 回收站对话框 */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-muted-foreground" />
              回收站
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {trashLoading ? (
              <div className="text-center py-8 text-muted-foreground">加载中...</div>
            ) : trashNovels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trash2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">回收站为空</p>
              </div>
            ) : (
              trashNovels.map((n) => (
                <div key={n.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="w-10 h-14 rounded bg-gradient-to-br from-primary/15 to-gold/10 border border-border/60 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary/60">
                      {n.title.slice(0, 2)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{n.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {n.genre} · {formatWords(n.totalWords)} 字
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      删除时间：{n.deletedAt ? new Date(n.deletedAt).toLocaleString('zh-CN') : '-'}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => handleRestore(n.id)}
                    >
                      <RotateCcw className="w-3 h-3" />
                      恢复
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-600"
                      onClick={() => handlePurge(n.id, n.title)}
                    >
                      <Trash2 className="w-3 h-3" />
                      永久删除
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrashOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入 TXT 建书 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              导入 TXT 小说（自动识别分章）
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">书名（可选，留空自动从文件名/内容提取）</Label>
              <Input
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder="输入作品名称..."
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">选择本地 .txt 文件</Label>
              <Input
                type="file"
                accept=".txt,text/plain"
                className="h-9 text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (!importTitle.trim()) {
                    setImportTitle(file.name.replace(/\.txt$/i, ''))
                  }
                  const reader = new FileReader()
                  reader.onload = () => setImportContent(String(reader.result || ''))
                  reader.readAsText(file)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">或直接粘贴小说文本</Label>
              <Textarea
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                rows={6}
                placeholder="粘贴章节内容（支持自动识别 第X章 等标题）..."
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={handleImportTxt} disabled={importing} className="gap-1.5">
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              开始导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NovelCard({
  novel,
  onOpen,
  onDelete,
}: {
  novel: Novel
  onOpen: () => void
  onDelete: () => void
}) {
  const genreColors: Record<string, string> = {
    玄幻: 'bg-primary/10 text-primary',
    言情: 'bg-cinnabar/10 text-cinnabar',
    科幻: 'bg-jade/10 text-jade',
    悬疑: 'bg-ink-soft/10 text-ink-soft',
    历史: 'bg-gold/15 text-gold',
    都市: 'bg-primary/10 text-primary',
    武侠: 'bg-gold/15 text-gold',
    游戏: 'bg-jade/10 text-jade',
    奇幻: 'bg-primary/10 text-primary',
    军事: 'bg-cinnabar/10 text-cinnabar',
  }

  return (
    <Card
      className="studio-novel-card group overflow-hidden hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/40 transition-all duration-200 cursor-pointer"
      onClick={onOpen}
    >
      <div className="studio-novel-cover bg-gradient-to-br from-primary/12 via-gold/10 to-jade/10 relative overflow-hidden">
        {novel.cover ? (
          <img
            src={novel.cover}
            alt={novel.title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl font-bold text-primary/60">
              {novel.title.slice(0, 2)}
            </span>
          </div>
        )}
        <div className="absolute top-2.5 left-2.5">
          <Badge className={`${genreColors[novel.genre] || 'bg-muted text-muted-foreground'} backdrop-blur-xs shadow-2xs`}>
            {novel.genre}
          </Badge>
        </div>
        <div className="absolute top-2.5 right-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                aria-label="作品操作"
                className="bg-background/85 backdrop-blur-xs rounded-md p-1 hover:bg-background shadow-xs transition"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem className="text-cinnabar focus:text-cinnabar" onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CardContent className="p-4">
        <h4 className="font-semibold truncate group-hover:text-primary transition-colors">
          <button type="button" className="max-w-full truncate text-left" onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}>{novel.title}</button>
        </h4>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 h-9 leading-relaxed">
          {novel.synopsis || '暂无简介'}
        </p>
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground tabular-nums">
          <span>{formatWords(novel.totalWords)} 字</span>
          <span>{formatTime(novel.updatedAt)}</span>
        </div>
        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border/50">
          <Badge
            variant="outline"
            className={
              novel.status === 'ongoing'
                ? 'text-jade border-jade/40 bg-jade/10'
                : novel.status === 'completed'
                  ? 'text-primary border-primary/40 bg-primary/10'
                  : 'text-gold border-gold/40 bg-gold/10'
            }
          >
            {novel.status === 'ongoing' ? '连载中' : novel.status === 'completed' ? '已完结' : '暂停'}
          </Badge>
          <span className="text-xs font-medium text-muted-foreground group-hover:text-primary flex items-center gap-0.5 transition-colors">
            进入写作
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
