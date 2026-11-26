'use client'

import { useEffect, useState } from 'react'
import { useAppStore, type ViewType } from '@/lib/store'
import { WorkspaceView } from '@/components/workspace/workspace-view'
import { EditorView } from '@/components/editor/editor-view'
import { SettingsLibrary } from '@/components/settings/settings-library'
import { UserCenter } from '@/components/user/user-center'
import { TopBar } from '@/components/layout/top-bar'
import { AuthView } from '@/components/auth/auth-view'
import { AdminView } from '@/components/admin/admin-view'
import { AutoSerialPanel } from '@/components/editor/auto-serial-panel'
import { PlazaView } from '@/components/plaza/plaza-view'
import { AiToolboxView } from '@/components/tools/ai-toolbox-view'
import { ForceChangePasswordDialog } from '@/components/auth/force-change-password'
import { OnboardingDialog } from '@/components/onboarding/onboarding-dialog'

export default function Home() {
  const { view, theme, currentNovelId, user, authLoading, forceChangePassword, restoreFromHistory } = useAppStore()
  const [mounted] = useState(true)
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  useEffect(() => {
    if (!user || forceChangePassword) return
    try {
      const done = localStorage.getItem(`moling_onboarding_done_${user.id}`)
      if (!done) {
        setOnboardingOpen(true)
      }
    } catch {}
  }, [user, forceChangePassword])

  const markOnboardingDone = () => {
    if (!user) return
    try {
      localStorage.setItem(`moling_onboarding_done_${user.id}`, '1')
    } catch {}
  }

  useEffect(() => {
    // 同步浏览器历史记录，支持浏览器前进/后退返回上一级而不退出网站
    const params = new URLSearchParams(window.location.search)
    const initialView = (params.get('view') as ViewType) || 'workspace'
    const initialNovelId = params.get('novelId')
    const initialChapterId = params.get('chapterId')
    if (initialView !== 'workspace' || initialNovelId) {
      restoreFromHistory({
        view: initialView,
        currentNovelId: initialNovelId,
        currentChapterId: initialChapterId,
      })
    }
    window.history.replaceState(
      {
        view: initialView,
        currentNovelId: initialNovelId,
        currentChapterId: initialChapterId,
      },
      '',
      window.location.pathname + window.location.search
    )

    const onPopState = (e: PopStateEvent) => {
      if (e.state && e.state.view) {
        restoreFromHistory({
          view: e.state.view,
          currentNovelId: e.state.currentNovelId ?? null,
          currentChapterId: e.state.currentChapterId ?? null,
        })
      } else {
        restoreFromHistory({
          view: 'workspace',
          currentNovelId: null,
          currentChapterId: null,
        })
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [restoreFromHistory])

  useEffect(() => {
    // 应用主题
    const root = document.documentElement
    root.classList.remove('dark', 'theme-eye')
    if (theme === 'dark') root.classList.add('dark')
    else if (theme === 'eye') root.classList.add('theme-eye')
  }, [theme])

  if (!mounted) return null

  // 鉴权加载中
  if (authLoading) {
    return (
      <div className="h-screen h-[100dvh] overflow-hidden flex flex-col bg-background text-foreground">
        <TopBar />
        <main className="flex-1 min-h-0 flex items-center justify-center">
          <div className="text-muted-foreground text-sm">加载中...</div>
        </main>
      </div>
    )
  }

  // 未登录 - 显示登录/注册页
  if (!user) {
    return (
      <div className="h-screen h-[100dvh] overflow-hidden flex flex-col bg-background text-foreground">
        <TopBar />
        <main className="flex-1 min-h-0 flex overflow-auto">
          <AuthView />
        </main>
      </div>
    )
  }

  // 已登录
  return (
    <div className="h-screen h-[100dvh] overflow-hidden flex flex-col bg-background text-foreground">
      <TopBar />
      <main className="flex-1 min-h-0 flex overflow-hidden">
        {view === 'workspace' && <WorkspaceView />}
        {view === 'toolbox' && <AiToolboxView />}
        {view === 'plaza' && <PlazaView />}
        {view === 'editor' && currentNovelId && <EditorView />}
        {view === 'settings' && <SettingsLibrary />}
        {view === 'user' && <UserCenter />}
        {view === 'admin' && user.role === 'admin' && <AdminView />}
        {view === 'admin' && user.role !== 'admin' && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            无权访问管理后台
          </div>
        )}
      </main>

      {/* 强制修改密码弹窗 */}
      <ForceChangePasswordDialog
        open={forceChangePassword}
        onClose={() => {}}
      />

      {/* 首次登录新手引导教程（支持跳过） */}
      <OnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onFinish={markOnboardingDone}
      />
    </div>
  )
}
