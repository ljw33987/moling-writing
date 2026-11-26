'use client'

import { create } from 'zustand'

export type ViewType = 'workspace' | 'editor' | 'toolbox' | 'settings' | 'user' | 'admin' | 'login' | 'register' | 'plaza'

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

interface AppState {
  // 鉴权
  user: UserPublic | null
  authLoading: boolean

  // 视图状态
  view: ViewType
  currentNovelId: string | null
  currentChapterId: string | null
  currentFolderId: string | null

  // 编辑器模式
  editorMode: 'normal' | 'focus' | 'typewriter'
  theme: 'light' | 'dark' | 'eye'
  leftPanelOpen: boolean
  rightPanelOpen: boolean

  // AI 助手
  aiPanelOpen: boolean
  presetOpen: boolean

  // 强制修改密码
  forceChangePassword: boolean

  // Actions
  setUser: (u: UserPublic | null) => void
  setAuthLoading: (b: boolean) => void
  setView: (v: ViewType) => void
  openNovel: (novelId: string) => void
  setCurrentChapter: (id: string | null) => void
  setCurrentFolder: (id: string | null) => void
  setEditorMode: (m: 'normal' | 'focus' | 'typewriter') => void
  setTheme: (t: 'light' | 'dark' | 'eye') => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  toggleAiPanel: () => void
  setPresetOpen: (v: boolean) => void
  setForceChangePassword: (v: boolean) => void
  backToWorkspace: () => void
  restoreFromHistory: (state: {
    view: ViewType
    currentNovelId: string | null
    currentChapterId: string | null
  }) => void
}

function buildUrlForState(
  view: ViewType,
  novelId: string | null,
  chapterId: string | null
): string {
  if (typeof window === 'undefined') return '/'
  const params = new URLSearchParams()
  if (view && view !== 'workspace') params.set('view', view)
  if (view === 'editor' && novelId) params.set('novelId', novelId)
  if (view === 'editor' && chapterId) params.set('chapterId', chapterId)
  const qs = params.toString()
  return qs ? `/?${qs}` : '/'
}

export function pushAppHistory(
  view: ViewType,
  currentNovelId: string | null,
  currentChapterId: string | null
) {
  if (typeof window === 'undefined') return
  const nextUrl = buildUrlForState(view, currentNovelId, currentChapterId)
  const cur = window.history.state
  if (
    cur &&
    cur.view === view &&
    cur.currentNovelId === currentNovelId &&
    cur.currentChapterId === currentChapterId
  ) {
    return
  }
  window.history.pushState({ view, currentNovelId, currentChapterId }, '', nextUrl)
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  authLoading: true,

  view: 'workspace',
  currentNovelId: null,
  currentChapterId: null,
  currentFolderId: null,

  editorMode: 'normal',
  theme: 'light',
  leftPanelOpen: true,
  rightPanelOpen: true,

  aiPanelOpen: true,
  presetOpen: false,
  forceChangePassword: false,

  setUser: (u) => set({ user: u }),
  setAuthLoading: (b) => set({ authLoading: b }),
  setView: (v) => {
    const { currentNovelId, currentChapterId } = get()
    const nextNovel = v === 'editor' ? currentNovelId : null
    const nextChapter = v === 'editor' ? currentChapterId : null
    set({ view: v })
    pushAppHistory(v, nextNovel, nextChapter)
  },
  openNovel: (novelId) => {
    set({ view: 'editor', currentNovelId: novelId, currentChapterId: null })
    pushAppHistory('editor', novelId, null)
  },
  setCurrentChapter: (id) => set({ currentChapterId: id }),
  setCurrentFolder: (id) => set({ currentFolderId: id }),
  setEditorMode: (m) => set({ editorMode: m }),
  setTheme: (t) => set({ theme: t }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setPresetOpen: (v) => set({ presetOpen: v }),
  setForceChangePassword: (v) => set({ forceChangePassword: v }),
  backToWorkspace: () => {
    set({ view: 'workspace', currentNovelId: null, currentChapterId: null })
    pushAppHistory('workspace', null, null)
  },
  restoreFromHistory: (state) => {
    set({
      view: state.view || 'workspace',
      currentNovelId: state.currentNovelId ?? null,
      currentChapterId: state.currentChapterId ?? null,
    })
  },
}))
