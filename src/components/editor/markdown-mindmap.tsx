'use client'

import React, { useState, useRef, useMemo } from 'react'
import { Plus, Sparkles, Trash2, Check, X, ChevronRight, Loader2 } from 'lucide-react'
import type { NovelDetail } from './editor-view'

export interface MindmapNode {
  id: string
  label: string
  level: number
  children: MindmapNode[]
}

/**
 * 将 Markdown 大纲（# / ## / ### / - ）解析为思维导图树
 */
export function parseMarkdownToMindmap(markdown: string, fallbackTitle = '故事思维导图'): MindmapNode {
  const lines = (markdown || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)

  const root: MindmapNode = {
    id: 'root',
    label: fallbackTitle,
    level: 1,
    children: [],
  }

  if (lines.length === 0) return root

  const stack: MindmapNode[] = [root]
  let idx = 0

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    let level = 3
    let label = trimmed

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      level = headingMatch[1].length
      label = headingMatch[2].trim()
      if (level === 1 && root.children.length === 0 && root.label === fallbackTitle) {
        root.label = label
        continue
      }
    } else {
      const listMatch = rawLine.match(/^(\s*)[-*+•]\s+(.+)$/)
      if (listMatch) {
        const indent = Math.floor(listMatch[1].length / 2)
        level = 4 + indent
        label = listMatch[2].trim()
      } else {
        const numMatch = rawLine.match(/^(\s*)\d+[.)]\s+(.+)$/)
        if (numMatch) {
          const indent = Math.floor(numMatch[1].length / 2)
          level = 4 + indent
          label = numMatch[2].trim()
        } else {
          level = 4
        }
      }
    }

    const node: MindmapNode = {
      id: `mm-${idx++}`,
      label,
      level,
      children: [],
    }

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  return root
}

/**
 * 将思维导图树序列化回干净的 Markdown 大纲文档
 */
export function serializeMindmapToMarkdown(root: MindmapNode): string {
  const lines: string[] = [`# ${root.label}`]

  const walk = (node: MindmapNode, depth: number) => {
    if (depth === 1) {
      lines.push(`\n## ${node.label}`)
    } else if (depth === 2) {
      lines.push(`### ${node.label}`)
    } else {
      const indent = '  '.repeat(Math.max(0, depth - 3))
      lines.push(`${indent}- ${node.label}`)
    }
    for (const child of node.children) {
      walk(child, depth + 1)
    }
  }

  for (const child of root.children) {
    walk(child, 1)
  }

  return lines.join('\n').trim()
}

/**
 * 根据小说当前目录、简介与大纲生成初始思维导图文档
 */
export function buildInitialMindmapDoc(novel: NovelDetail): string {
  const lines: string[] = [`# 《${novel.title}》`]

  if (novel.synopsis?.trim()) {
    lines.push('\n## 核心梗概')
    lines.push(`- ${novel.synopsis.trim().slice(0, 120)}`)
  }

  if (novel.outline?.trim()) {
    lines.push('\n## 主线大纲')
    const outlineLines = novel.outline
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 12)
    for (const ol of outlineLines) {
      lines.push(ol.startsWith('-') || ol.startsWith('#') ? ol : `- ${ol}`)
    }
  }

  if (novel.volumes.length > 0) {
    lines.push('\n## 分卷与章节脉络')
    for (const vol of novel.volumes) {
      lines.push(`### ${vol.title}`)
      for (const ch of vol.chapters) {
        lines.push(`- ${ch.title}（${ch.words}字）`)
      }
    }
  }

  return lines.join('\n')
}

const BRANCH_COLORS = [
  { stroke: '#6366f1', bg: 'bg-indigo-500/10 border-indigo-500/40 text-indigo-700 dark:text-indigo-300' },
  { stroke: '#10b981', bg: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  { stroke: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300' },
  { stroke: '#0ea5e9', bg: 'bg-sky-500/10 border-sky-500/40 text-sky-700 dark:text-sky-300' },
  { stroke: '#f43f5e', bg: 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300' },
]

interface PositionedNode {
  node: MindmapNode
  depth: number
  branchIdx: number
  parentId: string | null
  x: number
  y: number
  w: number
  h: number
}

interface EdgePath {
  id: string
  d: string
  stroke: string
}

function estimateNodeSize(label: string, depth: number): { w: number; h: number } {
  const charUnits = Array.from(label).reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 13 : 7.5), 0)
  const pad = depth === 0 ? 40 : 30
  const maxW = depth === 0 ? 220 : 210
  const minW = depth === 0 ? 110 : 84
  const w = Math.min(maxW, Math.max(minW, Math.ceil(charUnits + pad)))
  const lines = Math.max(1, Math.ceil((charUnits + pad) / maxW))
  const h = depth === 0 ? 42 + (lines - 1) * 18 : 34 + (lines - 1) * 17
  return { w, h }
}

function layoutMindmap(
  root: MindmapNode,
  collapsed: Record<string, boolean>
): { nodes: PositionedNode[]; edges: EdgePath[]; width: number; height: number } {
  const nodes: PositionedNode[] = []
  const edges: EdgePath[] = []
  const H_GAP = 54
  const V_GAP = 14

  interface SubtreeResult {
    height: number
    centerY: number
  }

  const measureAndPlace = (
    node: MindmapNode,
    depth: number,
    branchIdx: number,
    parentId: string | null,
    x: number,
    topY: number
  ): SubtreeResult => {
    const { w, h } = estimateNodeSize(node.label, depth)
    const isCollapsed = !!collapsed[node.id]
    const visibleChildren = isCollapsed ? [] : node.children

    if (visibleChildren.length === 0) {
      nodes.push({ node, depth, branchIdx, parentId, x, y: topY, w, h })
      return { height: h + V_GAP, centerY: topY + h / 2 }
    }

    let cursorY = topY
    const childCenters: number[] = []
    const childX = x + w + H_GAP

    visibleChildren.forEach((child, idx) => {
      const bIdx = depth === 0 ? idx : branchIdx
      const res = measureAndPlace(child, depth + 1, bIdx, node.id, childX, cursorY)
      childCenters.push(res.centerY)
      cursorY += res.height
    })

    const totalH = cursorY - topY
    const firstCenter = childCenters[0]
    const lastCenter = childCenters[childCenters.length - 1]
    const centerY = (firstCenter + lastCenter) / 2
    const y = centerY - h / 2

    nodes.push({ node, depth, branchIdx, parentId, x, y, w, h })

    const startX = x + w
    const startY = centerY
    visibleChildren.forEach((child, idx) => {
      const bIdx = depth === 0 ? idx : branchIdx
      const color = BRANCH_COLORS[bIdx % BRANCH_COLORS.length].stroke
      const endX = childX
      const endY = childCenters[idx]
      const c1x = startX + H_GAP * 0.5
      const c2x = endX - H_GAP * 0.5
      edges.push({
        id: `${node.id}->${child.id}`,
        d: `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`,
        stroke: color,
      })
    })

    return { height: Math.max(h + V_GAP, totalH), centerY }
  }

  measureAndPlace(root, 0, 0, null, 36, 32)

  let maxX = 400
  let maxY = 300
  for (const n of nodes) {
    if (n.x + n.w + 80 > maxX) maxX = n.x + n.w + 80
    if (n.y + n.h + 60 > maxY) maxY = n.y + n.h + 60
  }

  return { nodes, edges, width: maxX, height: maxY }
}

interface InteractiveMindmapProps {
  root: MindmapNode
  zoom: number
  onTreeChange: (nextRoot: MindmapNode) => void
  onAiExpandNode?: (nodeId: string, label: string) => Promise<void>
  expandingNodeId?: string | null
}

function cloneTree(node: MindmapNode): MindmapNode {
  return { ...node, children: node.children.map(cloneTree) }
}

function findAndMutate(
  node: MindmapNode,
  targetId: string,
  mutator: (target: MindmapNode, parent: MindmapNode | null, index: number) => void,
  parent: MindmapNode | null = null,
  index = 0
): boolean {
  if (node.id === targetId) {
    mutator(node, parent, index)
    return true
  }
  for (let i = 0; i < node.children.length; i++) {
    if (findAndMutate(node.children[i], targetId, mutator, node, i)) return true
  }
  return false
}

export function MindmapTreeView({
  root,
  zoom = 1,
  onTreeChange,
  onAiExpandNode,
  expandingNodeId,
}: {
  root: MindmapNode
  zoom?: number
  onTreeChange?: (nextRoot: MindmapNode) => void
  onAiExpandNode?: (nodeId: string, label: string) => Promise<void>
  expandingNodeId?: string | null
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<{ active: boolean; startX: number; startY: number; scrollLeft: number; scrollTop: number }>({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })

  const { nodes, edges, width, height } = useMemo(
    () => layoutMindmap(root, collapsed),
    [root, collapsed]
  )

  const startEdit = (node: MindmapNode) => {
    if (!onTreeChange) return
    setEditingId(node.id)
    setEditingText(node.label)
  }

  const commitEdit = () => {
    if (!editingId || !onTreeChange) {
      setEditingId(null)
      return
    }
    const nextLabel = editingText.trim()
    if (nextLabel) {
      const copy = cloneTree(root)
      findAndMutate(copy, editingId, (target) => {
        target.label = nextLabel
      })
      onTreeChange(copy)
    }
    setEditingId(null)
  }

  const addChild = (parentId: string) => {
    if (!onTreeChange) return
    const copy = cloneTree(root)
    const newId = `mm-${Date.now()}`
    findAndMutate(copy, parentId, (target) => {
      target.children.push({
        id: newId,
        label: '新分支节点',
        level: target.level + 1,
        children: [],
      })
    })
    setCollapsed((prev) => ({ ...prev, [parentId]: false }))
    onTreeChange(copy)
    setEditingId(newId)
    setEditingText('新分支节点')
  }

  const addSibling = (nodeId: string) => {
    if (!onTreeChange) return
    const copy = cloneTree(root)
    const newId = `mm-${Date.now()}`
    findAndMutate(copy, nodeId, (_target, parent, index) => {
      if (!parent) return
      parent.children.splice(index + 1, 0, {
        id: newId,
        label: '同级节点',
        level: parent.level + 1,
        children: [],
      })
    })
    onTreeChange(copy)
    setEditingId(newId)
    setEditingText('同级节点')
  }

  const deleteNode = (nodeId: string) => {
    if (!onTreeChange || nodeId === 'root') return
    const copy = cloneTree(root)
    findAndMutate(copy, nodeId, (_target, parent, index) => {
      if (!parent) return
      parent.children.splice(index, 1)
    })
    onTreeChange(copy)
    if (selectedId === nodeId) setSelectedId(null)
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-mindmap-node]')) return
    const el = containerRef.current
    if (!el) return
    draggingRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingRef.current.active || !containerRef.current) return
    const dx = e.clientX - draggingRef.current.startX
    const dy = e.clientY - draggingRef.current.startY
    containerRef.current.scrollLeft = draggingRef.current.scrollLeft - dx
    containerRef.current.scrollTop = draggingRef.current.scrollTop - dy
  }

  const handleMouseUp = () => {
    draggingRef.current.active = false
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className="flex-1 min-h-0 overflow-auto cursor-grab active:cursor-grabbing bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:20px_20px] select-none"
    >
      <div
        style={{
          width: width * zoom,
          height: height * zoom,
          position: 'relative',
        }}
      >
        <div
          style={{
            width,
            height,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            position: 'relative',
          }}
        >
          {/* SVG 贝塞尔连线层 */}
          <svg
            width={width}
            height={height}
            className="absolute inset-0 pointer-events-none"
          >
            {edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.d}
                fill="none"
                stroke={edge.stroke}
                strokeWidth={2}
                strokeOpacity={0.55}
              />
            ))}
          </svg>

          {/* 节点层 */}
          {nodes.map(({ node, depth, branchIdx, x, y, w, h }) => {
            const palette = BRANCH_COLORS[branchIdx % BRANCH_COLORS.length]
            const isEditing = editingId === node.id
            const isSelected = selectedId === node.id
            const isCollapsed = !!collapsed[node.id]
            const hasChildren = node.children.length > 0
            const isExpanding = expandingNodeId === node.id

            return (
              <div
                key={node.id}
                data-mindmap-node="true"
                style={{ left: x, top: y, width: w, minHeight: h }}
                onClick={() => setSelectedId(node.id)}
                onDoubleClick={() => startEdit(node)}
                className={`group absolute rounded-lg border px-2.5 py-1.5 text-xs transition-shadow flex items-center justify-between gap-1 ${
                  depth === 0
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-indigo-500 font-bold shadow-md'
                    : depth === 1
                    ? `${palette.bg} font-semibold shadow-xs`
                    : 'bg-card border-border text-foreground shadow-2xs hover:border-primary/50'
                } ${isSelected ? 'ring-2 ring-indigo-500/60' : ''}`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1 w-full">
                    <input
                      autoFocus
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full bg-background text-foreground px-1.5 py-0.5 rounded text-xs border border-border outline-none"
                    />
                    <button type="button" onMouseDown={commitEdit} className="text-emerald-500">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="leading-snug break-words flex-1">{node.label}</span>
                )}

                {/* 折叠指示器 */}
                {hasChildren && !isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCollapsed((prev) => ({ ...prev, [node.id]: !prev[node.id] }))
                    }}
                    className={`shrink-0 rounded-full text-[10px] w-4 h-4 flex items-center justify-center border transition ${
                      isCollapsed
                        ? 'bg-indigo-500 text-white border-indigo-500'
                        : 'bg-background/80 text-muted-foreground border-border hover:text-foreground'
                    }`}
                    title={isCollapsed ? `展开 (${node.children.length})` : '收起分支'}
                  >
                    {isCollapsed ? node.children.length : <ChevronRight className="w-2.5 h-2.5 rotate-90" />}
                  </button>
                )}

                {/* 悬浮操作条（直接加子节点、同级、AI 扩展、删除） */}
                {onTreeChange && !isEditing && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-7 right-0 z-20 flex items-center gap-0.5 bg-popover border border-border rounded-md shadow-md px-1 py-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        addChild(node.id)
                      }}
                      className="px-1.5 py-0.5 text-[10px] hover:bg-muted rounded flex items-center gap-0.5 text-foreground"
                      title="添加子节点"
                    >
                      <Plus className="w-2.5 h-2.5" />子
                    </button>
                    {depth > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          addSibling(node.id)
                        }}
                        className="px-1.5 py-0.5 text-[10px] hover:bg-muted rounded text-foreground"
                        title="添加同级节点"
                      >
                        +同级
                      </button>
                    )}
                    {onAiExpandNode && (
                      <button
                        type="button"
                        disabled={isExpanding}
                        onClick={(e) => {
                          e.stopPropagation()
                          void onAiExpandNode(node.id, node.label)
                        }}
                        className="px-1.5 py-0.5 text-[10px] hover:bg-muted rounded text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5"
                        title="AI 扩写此节点"
                      >
                        {isExpanding ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                        AI
                      </button>
                    )}
                    {depth > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteNode(node.id)
                        }}
                        className="p-0.5 hover:bg-destructive/10 rounded text-destructive"
                        title="删除节点"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
