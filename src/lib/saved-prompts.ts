export interface SavedPromptItem {
  id: string
  title: string
  category: string
  description: string
  promptText: string
  savedAt?: string
}

const STORAGE_KEY = 'moling_my_saved_prompts'
export const SAVED_PROMPTS_EVENT = 'moling:saved-prompts-updated'

export function cleanPromptSuffix(text: string): string {
  return (text || '')
    .replace(/\n*—{3,}\n*【待处理素材】[\s\S]*$/m, '')
    .replace(/\n*【待处理素材】[\s\S]*$/m, '')
    .trimEnd()
}

export function getSavedPrompts(): SavedPromptItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((p) => ({
      ...p,
      promptText: cleanPromptSuffix(p.promptText || ''),
    }))
  } catch {
    return []
  }
}

function writeSavedPrompts(list: SavedPromptItem[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    window.dispatchEvent(new CustomEvent(SAVED_PROMPTS_EVENT))
  } catch {}
}

export function savePromptToLibrary(item: SavedPromptItem): SavedPromptItem[] {
  const current = getSavedPrompts()
  const idx = current.findIndex((p) => p.id === item.id)
  const nextItem: SavedPromptItem = {
    ...item,
    savedAt: new Date().toISOString(),
  }
  const next = idx >= 0
    ? current.map((p, i) => (i === idx ? nextItem : p))
    : [nextItem, ...current]
  writeSavedPrompts(next)
  return next
}

export function removeSavedPrompt(id: string): SavedPromptItem[] {
  const next = getSavedPrompts().filter((p) => p.id !== id)
  writeSavedPrompts(next)
  return next
}
