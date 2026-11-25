'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'

export type SaveState =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error'

export interface RecoveryDraft {
  chapterId: string
  content: string
  at: number
}

interface StoredDraft {
  content: string
  at: number
}

/**
 * 三层防丢稿自动保存（移植自墨枢 Moshu）：
 * 1. 输入即写 IndexedDB 本地草稿（断电/刷新不丢）
 * 2. 节流上传服务端（支持离线恢复后自动补传）
 * 3. 切章时先检查本地是否有比服务端更新的未同步草稿
 */
export function useAutosave(
  chapterId: string | null,
  saveToServer: (chapterId: string, content: string) => Promise<void>,
  throttleMs = 2000
) {
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef<Map<string, string>>(new Map())
  const cleanRef = useRef<Map<string, string>>(new Map())
  const saveFnRef = useRef(saveToServer)
  useEffect(() => {
    saveFnRef.current = saveToServer
  }, [saveToServer])

  const flush = useCallback(async (targetChapterId?: string) => {
    if (savingRef.current || pendingRef.current.size === 0) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setState('offline')
      return
    }
    const id =
      targetChapterId && pendingRef.current.has(targetChapterId)
        ? targetChapterId
        : pendingRef.current.keys().next().value
    if (!id) return
    const content = pendingRef.current.get(id)
    if (content === undefined) return

    if (cleanRef.current.get(id) === content) {
      pendingRef.current.delete(id)
      await idbDel(`moling:draft:${id}`).catch(() => {})
      if (pendingRef.current.size === 0) setState('idle')
      return
    }

    savingRef.current = true
    setState('saving')
    try {
      await saveFnRef.current(id, content)
      cleanRef.current.set(id, content)
      if (pendingRef.current.get(id) === content) {
        pendingRef.current.delete(id)
        await idbDel(`moling:draft:${id}`).catch(() => {})
      }
      setSavedAt(new Date())
      setState(pendingRef.current.size > 0 ? 'dirty' : 'saved')
    } catch {
      setState(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'offline'
          : 'error'
      )
    } finally {
      savingRef.current = false
      if (pendingRef.current.size > 0) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void flush(), throttleMs)
      }
    }
  }, [throttleMs])

  useEffect(() => {
    const onOnline = () => {
      if (pendingRef.current.size > 0) void flush()
    }
    const onOffline = () => setState('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [flush])

  const markClean = useCallback((id: string, content: string) => {
    cleanRef.current.set(id, content)
    if (pendingRef.current.get(id) === content) {
      pendingRef.current.delete(id)
      void idbDel(`moling:draft:${id}`).catch(() => {})
    }
  }, [])

  const checkRecovery = useCallback(async (id: string, serverContent: string) => {
    cleanRef.current.set(id, serverContent)
    try {
      const stored = await idbGet<StoredDraft>(`moling:draft:${id}`)
      if (stored && stored.content !== serverContent) {
        setRecoveryDraft({
          chapterId: id,
          content: stored.content,
          at: stored.at,
        })
      } else {
        setRecoveryDraft(null)
      }
    } catch {
      setRecoveryDraft(null)
    }
  }, [])

  const queueSave = useCallback(
    (id: string, content: string) => {
      if (cleanRef.current.get(id) === content && !pendingRef.current.has(id)) {
        return
      }
      pendingRef.current.set(id, content)
      setState(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'offline'
          : 'dirty'
      )
      void idbSet(`moling:draft:${id}`, {
        content,
        at: Date.now(),
      } satisfies StoredDraft).catch(() => {})

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(id), throttleMs)
    },
    [flush, throttleMs]
  )

  const dismissRecovery = useCallback(async () => {
    if (recoveryDraft) {
      await idbDel(`moling:draft:${recoveryDraft.chapterId}`).catch(() => {})
    }
    setRecoveryDraft(null)
  }, [recoveryDraft])

  const acceptRecovery = useCallback(() => {
    const draft = recoveryDraft
    setRecoveryDraft(null)
    if (draft) {
      queueSave(draft.chapterId, draft.content)
    }
    return draft
  }, [recoveryDraft, queueSave])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (pendingRef.current.size > 0) void flush()
    }
  }, [flush])

  return {
    state: chapterId ? state : ('idle' as SaveState),
    savedAt,
    recoveryDraft,
    markClean,
    checkRecovery,
    queueSave,
    flush,
    acceptRecovery,
    dismissRecovery,
  }
}
