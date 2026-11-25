'use client'

import { createContext, useContext } from 'react'

export interface CodexItem {
  id: string
  name: string
  type: 'character' | 'worldview' | 'item'
  summary?: string
}

export const CodexMapContext = createContext<Map<string, CodexItem>>(new Map())

export function useCodexItem(id: string): CodexItem | undefined {
  const map = useContext(CodexMapContext)
  return map.get(id)
}
