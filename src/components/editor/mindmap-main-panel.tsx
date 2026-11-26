'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Network,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Loader2,
  ArrowLeft,
  Columns2,
} from 'lucide-react'
import {
  MindmapTreeView,
  parseMarkdownToMindmap,
  serializeMindmapToMarkdown,
  type MindmapNode,
} from './markdown-mindmap'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'

export interface MindmapFile {
  id: string
  title: string
  content: string
  updatedAt: string
}

interface Props {
  file: MindmapFile
  novelId: string
  onChange: (updated: MindmapFile) => void
  onBackToEditor: () => void
}

function insertChildrenIntoNode(
  node: MindmapNode,
  targetId: string,
  childrenLabels: string[]
): MindmapNode {
  if (node.id === targetId) {
    return {
      ...node,
      children: [
        ...node.children,
        ...childrenLabels.map((label, i) => ({
          id: `mm-ai-${Date.now()}-${i}`,
          label,
          level: node.level + 1,
          children: [],
        })),
      ],
    }
  }
  return {
    ...node,
    children: node.children.map((c) => insertChildrenIntoNode(c, targetId, childrenLabels)),
  }
}

export function MindmapMainPanel({ file, novelId, onChange, onBackToEditor }: Props) {
  const [viewMode, setViewMode] = useState<'mindmap' | 'split' | 'text'>('mindmap')
  const [zoom, setZoom] = useState(1)
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const tree = useMemo(
    () => parseMarkdownToMindmap(file.content, file.title),
    [file.content, file.title]
  )

  const handleTreeChange = (nextRoot: MindmapNode) => {
    onChange({
      ...file,
      title: nextRoot.label || file.title,
      content: serializeMindmapToMarkdown(nextRoot),
      updatedAt: new Date().toISOString(),
    })
  }

  const handleAiExpandNode = async (nodeId: string, label: string) => {
    setExpandingNodeId(nodeId)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId,
          message: `请为思维导图节点「${label}」生成 3~4 个具体的下级分支节点。每行输出一个节点标题（简明扼要，15字以内，不要序号、不要符号、不要解释）。`,
        }),
      })
      const items = (r.reply || '')
        .split('\n')
        .map((l) => l.replace(/^[-*•#\d.\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 5)

      if (items.length === 0) {
        toast.info('未获取到有效分支')
        return
      }
      const updatedTree = insertChildrenIntoNode(tree, nodeId, items)
      handleTreeChange(updatedTree)
      toast.success(`已为「${label}」扩展 ${items.length} 个子节点`)
    } catch (e: any) {
      toast.error(e.message || 'AI 扩展失败')
    } finally {
      setExpandingNodeId(null)
    }
  }

  const handleAiOptimizeAll = async () => {
    setAiLoading(true)
    try {
      const r = await api<{ reply: string }>('/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          novelId,
          message: `请基于以下思维导图大纲，补充完善各分支细节，使其剧情冲突更清晰。\n严格使用 Markdown 层级格式输出（# 主题 / ## 分支 / ### 子节点 / - 细节，不要多余解释）：\n\n${file.content.slice(0, 3000)}`,
        }),
      })
      const cleaned = (r.reply || '').replace(/^```markdown\s*/i, '').replace(/```$/i, '').trim()
      if (cleaned) {
        onChange({
          ...file,
          content: cleaned,
          updatedAt: new Date().toISOString(),
        })
        toast.success('AI 已完善导图结构')
      }
    } catch (e: any) {
      toast.error(e.message || 'AI 优化失败')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
      {/* 顶部标题与模式切换栏 */}
      <div className="h-12 shrink-0 border-b border-border px-3 flex items-center justify-between gap-2 bg-card/40">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 shrink-0"
            onClick={onBackToEditor}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回正文
          </Button>
          <div className="h-4 w-px bg-border shrink-0" />
          <Network className="w-4 h-4 text-indigo-500 shrink-0" />
          <Input
            value={file.title}
            onChange={(e) =>
              onChange({ ...file, title: e.target.value, updatedAt: new Date().toISOString() })
            }
            className="h-7 border-0 bg-transparent px-1 font-semibold text-sm focus-visible:ring-0 max-w-[200px]"
            placeholder="导图文件标题"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* 思维导图 / 分屏同步 / 文本内容 切换 */}
          <div className="flex items-center border rounded-md p-0.5 bg-muted/40">
            <button
              type="button"
              onClick={() => setViewMode('mindmap')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition ${
                viewMode === 'mindmap' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              导图
            </button>
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition ${
                viewMode === 'split' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              分屏
            </button>
            <button
              type="button"
              onClick={() => setViewMode('text')}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition ${
                viewMode === 'text' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              文档
            </button>
          </div>

          {viewMode !== 'text' && (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}
                title="缩小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <Badge variant="secondary" className="text-[11px] font-mono px-1.5">
                {Math.round(zoom * 100)}%
              </Badge>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
                title="放大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setZoom(1)}
                title="重置缩放"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={handleAiOptimizeAll}
            disabled={aiLoading}
          >
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-indigo-500" />}
            AI 完善
          </Button>
        </div>
      </div>

      {/* 操作提示条 */}
      {viewMode !== 'text' && (
        <div className="px-4 py-1 border-b border-border bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between shrink-0">
          <span>双击任意节点可直接修改文字 · 悬停节点可「+子 / +同级 / AI 扩写 / 删除」· 拖拽空白处平移画布</span>
        </div>
      )}

      {/* 主展示/编辑区域 */}
      {viewMode === 'mindmap' ? (
        <MindmapTreeView
          root={tree}
          zoom={zoom}
          onTreeChange={handleTreeChange}
          onAiExpandNode={handleAiExpandNode}
          expandingNodeId={expandingNodeId}
        />
      ) : viewMode === 'split' ? (
        <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-border overflow-hidden">
          <div className="flex flex-col min-h-0 p-3 gap-1.5 overflow-hidden">
            <div className="text-[11px] text-muted-foreground shrink-0">
              实时文档编辑（右侧导图即时同步）
            </div>
            <Textarea
              value={file.content}
              onChange={(e) =>
                onChange({ ...file, content: e.target.value, updatedAt: new Date().toISOString() })
              }
              className="flex-1 min-h-0 resize-none font-mono text-xs leading-relaxed p-3"
            />
          </div>
          <MindmapTreeView
            root={tree}
            zoom={zoom}
            onTreeChange={handleTreeChange}
            onAiExpandNode={handleAiExpandNode}
            expandingNodeId={expandingNodeId}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col p-5 gap-2 overflow-hidden">
          <div className="text-xs text-muted-foreground shrink-0">
            按文档方式直接编辑：<code className="font-mono"># 主题</code>、<code className="font-mono">## 一级分支</code>、<code className="font-mono">### 二级节点</code>、<code className="font-mono">- 细节内容</code>
          </div>
          <Textarea
            value={file.content}
            onChange={(e) =>
              onChange({ ...file, content: e.target.value, updatedAt: new Date().toISOString() })
            }
            className="flex-1 min-h-0 resize-none font-mono text-sm leading-relaxed p-4"
          />
        </div>
      )}
    </div>
  )
}
