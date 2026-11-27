'use client'

import { useAppStore } from '@/lib/store'
import { LayoutGrid, Settings, User, Sparkles, PenLine, Shield, LogOut, Loader2, Bell, Megaphone, BookOpen, Search, HelpCircle } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { MessagesDialog } from '@/components/user/messages-dialog'
import { OnboardingDialog } from '@/components/onboarding/onboarding-dialog'
import { LanguageSwitcher } from './language-switcher'
import { useI18n } from '@/lib/i18n/store'
import { api, formatWords } from '@/lib/helpers'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'

interface UserPublic {
  id: string
  email: string
  name: string | null
  penName: string | null
  avatar: string | null
  tokens: number
  plan: string
  role: string
  banned: boolean
  createdAt: string
}

export function TopBar() {
  const { user, setUser, authLoading, view, setView, currentNovelId, backToWorkspace, setForceChangePassword } = useAppStore()
  const { t, hydrate } = useI18n()
  const [tokens, setTokens] = useState<number | null>(null)

  // 客户端 hydrate 语言
  useEffect(() => { hydrate() }, [hydrate])
  const [unreadCount, setUnreadCount] = useState(0)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  // 拉取未读数（供 MessagesDialog 通过 onUnreadChange 回调更新）
  const fetchUnread = useCallback(async () => {
    if (!user) return
    try {
      const [msgR, annR] = await Promise.all([
        api<{ unreadCount: number }>('/api/messages').catch(() => ({ unreadCount: 0 })),
        api<{ unreadCount: number }>('/api/announcements').catch(() => ({ unreadCount: 0 })),
      ])
      setUnreadCount((msgR.unreadCount || 0) + (annR.unreadCount || 0))
    } catch {}
  }, [user])

  // 启动时拉取当前用户
  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const r = await api<{ user: UserPublic | null; needChangePassword?: boolean }>('/api/auth/me')
        if (mounted) {
          setUser(r.user)
          if (r.user) {
            setTokens(r.user.tokens)
            // 根据后端返回设置/清除强制改密码状态
            setForceChangePassword(!!r.needChangePassword)
          } else {
            setForceChangePassword(false)
          }
        }
      } catch {
        // ignore
      } finally {
        if (mounted) useAppStore.setState({ authLoading: false })
      }
    }
    load()
  }, [setUser])

  // 拉取最新 token + 未读消息数
  useEffect(() => {
    if (!user) return
    let mounted = true
    const load = async () => {
      try {
        const userR = await api<{ user: { tokens: number } }>('/api/user')
        if (mounted) setTokens(userR.user.tokens)
        await fetchUnread()
      } catch {}
    }
    load()
    const i = setInterval(load, 30000)
    return () => {
      mounted = false
      clearInterval(i)
    }
  }, [user, view, fetchUnread])

  // 关闭弹窗后刷新未读数
  const handleMessagesOpenChange = (open: boolean) => {
    setMessagesOpen(open)
    if (!open) fetchUnread()
  }

  const handleLogout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setUser(null)
      setTokens(null)
      setView('login')
      toast.success('已退出登录')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const navs: {
    id: 'workspace' | 'editor' | 'toolbox' | 'plaza' | 'settings' | 'user' | 'admin'
    label: string
    icon: any
    adminOnly?: boolean
  }[] = [
    { id: 'workspace', label: t('nav.workspace'), icon: LayoutGrid },
    { id: 'editor', label: '编辑器', icon: PenLine },
    { id: 'toolbox', label: 'AI 工具箱', icon: Sparkles },
    { id: 'plaza', label: t('nav.plaza'), icon: BookOpen },
    { id: 'settings', label: t('nav.settings'), icon: Settings },
    { id: 'user', label: t('nav.user'), icon: User },
    { id: 'admin', label: '后台', icon: Shield, adminOnly: true },
  ]

  const handleNavClick = (id: 'workspace' | 'editor' | 'toolbox' | 'plaza' | 'settings' | 'user' | 'admin') => {
    if (id === 'editor' && !currentNovelId) {
      toast.info('请先从工作台选择或创建一部作品')
      setView('workspace')
      return
    }
    setView(id)
  }

  // 鉴权加载中
  if (authLoading) {
    return (
      <header className="topbar-shell flex items-center px-4 sm:px-6 z-30 sticky top-0 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[9px] ai-brand-mark flex items-center justify-center text-white font-bold text-sm">
            墨
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-foreground">爆更猫AI写作</span>
        </div>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
      </header>
    )
  }

  // 未登录
  if (!user) {
    return (
      <header className="topbar-shell flex items-center px-4 sm:px-6 z-30 sticky top-0 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[9px] ai-brand-mark flex items-center justify-center text-white font-bold text-sm">
            墨
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-foreground">爆更猫AI写作</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <Button onClick={() => setView('login')} size="sm" className="gap-1.5 rounded-[9px] px-4">
            <PenLine className="w-3.5 h-3.5" />
            登录 / 注册
          </Button>
        </div>
      </header>
    )
  }

  const visibleNavs = navs.filter((n) => !n.adminOnly || user.role === 'admin')

  return (
    <header className="topbar-shell flex items-center px-3 sm:px-6 gap-3 sm:gap-5 z-30 sticky top-0 shrink-0">
      <button onClick={backToWorkspace} className="flex items-center gap-2.5 hover:opacity-85 transition shrink-0">
        <div className="w-8 h-8 rounded-[9px] ai-brand-mark flex items-center justify-center text-white font-bold text-sm">
          墨
        </div>
        <span className="font-semibold text-[15px] tracking-tight text-foreground hidden sm:block">爆更猫AI写作</span>
      </button>

      <div className="h-5 w-px bg-border hidden md:block shrink-0" />

      <nav className="topbar-nav flex flex-1 min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleNavs.map((n) => {
          const Icon = n.icon
          const active = view === n.id
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => handleNavClick(n.id)}
              title={n.label}
              aria-label={n.label}
              className={`h-[34px] px-2.5 xl:px-3 rounded-[9px] shrink-0 inline-flex items-center gap-1.5 text-[13px] transition-colors ${
                active
                  ? 'bg-[var(--brand-soft)] text-[var(--brand-ink)] font-semibold'
                  : 'text-[var(--ink-2)] hover:text-foreground hover:bg-[var(--surface-3)] font-medium'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="hidden md:inline whitespace-nowrap">{n.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* 全局搜索胶囊 */}
        <button
          type="button"
          onClick={() => {
            setView('workspace')
            setTimeout(() => {
              const input = document.querySelector<HTMLInputElement>('input[placeholder*="搜索"]')
              input?.focus()
            }, 80)
          }}
          className="hidden lg:inline-flex items-center gap-2 h-8 w-44 xl:w-52 px-3 rounded-[9px] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-border text-xs text-muted-foreground transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">搜索...</span>
          <kbd className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-card border border-border text-muted-foreground">⌘K</kbd>
        </button>

        {/* 语言切换 */}
        <LanguageSwitcher />

        {/* 消息铃铛 */}
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 rounded-[9px] text-muted-foreground hover:text-foreground"
          onClick={() => setMessagesOpen(true)}
          title="平台消息与公告"
          aria-label="平台消息与公告"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-cinnabar text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>

        {tokens !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setView('user')}
                className="h-8 px-2.5 rounded-[9px] inline-flex items-center gap-1.5 text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-border transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="tnum font-semibold text-foreground whitespace-nowrap">
                  剩余 {formatWords(tokens * 3)}字
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="max-w-xs p-3 text-xs leading-relaxed bg-popover text-popover-foreground border border-border shadow-lg">
              <div className="font-semibold text-foreground">
                剩余可用总字数：{tokens * 3 >= 10000 ? `${((tokens * 3) / 10000).toFixed(1)} 万字` : `${(tokens * 3).toLocaleString()} 字`}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                精确剩余 {(tokens * 3).toLocaleString()} 字（包含 AI 阅读上下文输入与生成输出字数）
              </div>
            </TooltipContent>
          </Tooltip>
        )}

        {user.plan !== 'free' && (
          <Badge variant="outline" className="text-primary border-[var(--brand-line)] bg-[var(--brand-soft)] hidden xl:inline-flex rounded-[7px]">
            {user.plan === 'pro' ? '月卡' : user.plan === 'year' ? '年卡' : user.plan}
          </Badge>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:opacity-85 transition">
              <Avatar className="w-8 h-8 rounded-[9px]">
                <AvatarFallback className="rounded-[9px] bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] text-white text-xs font-bold">
                  {(user.penName || user.name || user.email)[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{user.penName || user.name || '未命名'}</span>
                <span className="text-xs text-muted-foreground font-normal">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setView('user')}>
              <User className="w-3.5 h-3.5 mr-2" />
              用户中心
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGuideOpen(true)}>
              <HelpCircle className="w-3.5 h-3.5 mr-2" />
              新手引导
            </DropdownMenuItem>
            {user.role === 'admin' && (
              <DropdownMenuItem onClick={() => setView('admin')}>
                <Shield className="w-3.5 h-3.5 mr-2" />
                管理后台
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-cinnabar focus:text-cinnabar">
              <LogOut className="w-3.5 h-3.5 mr-2" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 消息中心弹窗 */}
      <MessagesDialog
        open={messagesOpen}
        onOpenChange={handleMessagesOpenChange}
        onUnreadChange={setUnreadCount}
      />

      {/* 新手引导弹窗（可随时重新打开） */}
      <OnboardingDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        onFinish={() => {
          try {
            localStorage.setItem(`moling_onboarding_done_${user.id}`, '1')
          } catch {}
        }}
      />
    </header>
  )
}
