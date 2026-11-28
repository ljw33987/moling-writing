'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/helpers'
import { toast } from 'sonner'
import {
  Feather,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Loader2,
  Save,
  Wand2,
} from 'lucide-react'

export interface WritingStyleItem {
  id: string
  name: string
  description: string
  stylePrompt: string
  sampleText: string
  avoidPhrases: string
  isDefault: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  novelId?: string
  activeStyleId: string | null
  styles: WritingStyleItem[]
  onRefreshStyles: () => Promise<void> | void
  onBindStyle: (styleId: string | null) => Promise<void> | void
}

export function WritingStyleDialog({
  open,
  onOpenChange,
  novelId,
  activeStyleId,
  styles,
  onRefreshStyles,
  onBindStyle,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | 'new'>('new')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [stylePrompt, setStylePrompt] = useState('')
  const [sampleText, setSampleText] = useState('')
  const [avoidPhrases, setAvoidPhrases] = useState('')
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)

  const loadFormFromStyle = (s: WritingStyleItem | null) => {
    if (!s) {
      setSelectedId('new')
      setName('')
      setDescription('')
      setStylePrompt('')
      setSampleText('')
      setAvoidPhrases('')
      return
    }
    setSelectedId(s.id)
    setName(s.name)
    setDescription(s.description || '')
    setStylePrompt(s.stylePrompt || '')
    setSampleText(s.sampleText || '')
    setAvoidPhrases(s.avoidPhrases ?? '')
  }

  useEffect(() => {
    if (!open) return
    if (activeStyleId) {
      const found = styles.find((s) => s.id === activeStyleId)
      if (found) {
        loadFormFromStyle(found)
        return
      }
    }
    if (styles.length > 0) {
      loadFormFromStyle(styles[0])
    } else {
      loadFormFromStyle(null)
    }
  }, [open, activeStyleId, styles])

  const handleExtractFromSample = async () => {
    if (sampleText.trim().length < 80) {
      toast.error('请先在「作者样文摘录」中粘贴至少 80 字以上的正文样文')
      return
    }
    setExtracting(true)
    try {
      const res = await api<{ name: string; description: string; stylePrompt: string }>(
        '/api/writing-styles/extract',
        {
          method: 'POST',
          body: JSON.stringify({ sampleText }),
        }
      )
      if (!name.trim()) setName(res.name)
      if (!description.trim()) setDescription(res.description)
      setStylePrompt(res.stylePrompt)
      toast.success('已从样文提炼文风特征！可微调后保存')
    } catch (e: any) {
      toast.error(e.message || '文风提炼失败')
    } finally {
      setExtracting(false)
    }
  }

  const handleSave = async (applyToNovel: boolean) => {
    if (!name.trim()) {
      toast.error('请输入风格名称')
      return
    }
    if (!stylePrompt.trim() && !sampleText.trim()) {
      toast.error('请填写文风要求或粘贴作者样文')
      return
    }
    setSaving(true)
    try {
      let savedId = selectedId
      if (selectedId === 'new') {
        const res = await api<{ style: WritingStyleItem }>('/api/writing-styles', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            stylePrompt: stylePrompt.trim(),
            sampleText: sampleText.trim(),
            avoidPhrases: avoidPhrases.trim(),
          }),
        })
        savedId = res.style.id
        setSelectedId(savedId)
      } else {
        await api<{ style: WritingStyleItem }>('/api/writing-styles', {
          method: 'PATCH',
          body: JSON.stringify({
            id: selectedId,
            name: name.trim(),
            description: description.trim(),
            stylePrompt: stylePrompt.trim(),
            sampleText: sampleText.trim(),
            avoidPhrases: avoidPhrases.trim(),
          }),
        })
      }

      await onRefreshStyles()
      window.dispatchEvent(new CustomEvent('moling:writing-styles-updated'))
      if (applyToNovel && novelId && savedId !== 'new') {
        await onBindStyle(savedId)
        toast.success('已保存并应用到当前作品')
      } else {
        toast.success('写作风格已保存')
      }
    } catch (e: any) {
      toast.error(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/writing-styles?id=${id}`, { method: 'DELETE' })
      if (activeStyleId === id) {
        await onBindStyle(null)
      }
      await onRefreshStyles()
      window.dispatchEvent(new CustomEvent('moling:writing-styles-updated'))
      loadFormFromStyle(null)
      toast.success('已删除写作风格')
    } catch (e: any) {
      toast.error(e.message || '删除失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Feather className="w-4 h-4 text-primary" />
            作者文风
          </DialogTitle>
          <DialogDescription className="text-xs">
            指定作品的叙述视角、句段节奏和用词习惯，也可以从正文样文中提炼。已选文风优先于通用写作技能。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          {/* 左侧：风格列表 */}
          <div className="sm:w-52 shrink-0 border-b sm:border-b-0 sm:border-r border-border bg-muted/20 p-3 flex flex-col gap-2 overflow-y-auto">
            <Button
              size="sm"
              variant={selectedId === 'new' ? 'default' : 'outline'}
              className="w-full justify-start gap-1.5 text-xs h-8"
              onClick={() => loadFormFromStyle(null)}
            >
              <Plus className="w-3.5 h-3.5" />
              新建写作风格
            </Button>

            {novelId && (
              <button
                type="button"
                onClick={() => onBindStyle(null)}
                className={`w-full text-left px-2.5 py-2 rounded-md text-xs border transition flex items-center justify-between ${
                  !activeStyleId
                    ? 'border-primary/40 bg-primary/10 text-primary font-medium'
                    : 'border-transparent hover:bg-muted text-muted-foreground'
                }`}
              >
                <span>默认 AI（不绑定）</span>
                {!activeStyleId && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            )}

            <div className="text-[11px] font-medium text-muted-foreground mt-1 px-1">
              已保存风格 ({styles.length})
            </div>

            <div className="space-y-1">
              {styles.map((s) => {
                const isEditing = selectedId === s.id
                const isApplied = activeStyleId === s.id
                return (
                  <div
                    key={s.id}
                    onClick={() => loadFormFromStyle(s)}
                    className={`group cursor-pointer rounded-md px-2.5 py-2 text-xs border transition ${
                      isEditing
                        ? 'border-primary bg-card shadow-sm'
                        : 'border-transparent hover:bg-muted/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium truncate">{s.name}</span>
                      {isApplied && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/40 text-primary shrink-0">
                          使用中
                        </Badge>
                      )}
                    </div>
                    {s.description && (
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {s.description}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 右侧：编辑区 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium">
                  作者样文摘录 <span className="text-muted-foreground font-normal">（粘贴你写的片段，AI 将模仿其句式与语感）</span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs gap-1 shrink-0"
                  onClick={handleExtractFromSample}
                  disabled={extracting || sampleText.trim().length < 80}
                >
                  {extracting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wand2 className="w-3 h-3 text-primary" />
                  )}
                  {extracting ? '提炼中...' : 'AI 从样文提炼文风'}
                </Button>
              </div>
              <Textarea
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                rows={4}
                className="text-xs resize-y"
                placeholder="粘贴 200~2000 字你满意的正文片段（AI 对话、续写、润色、自动连载都会参照这段样文的节奏与口吻）..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">风格名称 *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="例如：冷峻短句悬疑风"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">一句话简介</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="例如：短句快节奏、少形容词、重动作"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">文风与叙事要求</label>
              <Textarea
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                rows={4}
                className="text-xs resize-y"
                placeholder="例如：&#10;1. 多用短句，每段不超过3行，节奏利落；&#10;2. 少用心理独白和空洞抒情，用动作和对话推进；&#10;3. 对话口语化、接地气，带一点冷幽默。"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">
                自定义禁用词 <span className="text-muted-foreground font-normal">（选填，以逗号或顿号分隔）</span>
              </label>
              <Input
                value={avoidPhrases}
                onChange={(e) => setAvoidPhrases(e.target.value)}
                className="h-8 text-xs"
                placeholder="例如：命运的齿轮开始转动"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
              <div>
                {selectedId !== 'new' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-cinnabar hover:text-cinnabar gap-1"
                    onClick={() => handleDelete(selectedId)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除此风格
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  disabled={saving}
                  onClick={() => handleSave(false)}
                >
                  <Save className="w-3.5 h-3.5" />
                  仅保存
                </Button>
                {novelId && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs gap-1 bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white border-0"
                    disabled={saving}
                    onClick={() => handleSave(true)}
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    保存并应用到本书
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
