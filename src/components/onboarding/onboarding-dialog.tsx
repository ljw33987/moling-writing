'use client'

import { useState } from 'react'
import { useAppStore, type ViewType } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  LayoutGrid,
  PenLine,
  Sparkles,
  Settings,
  Compass,
  BookOpen,
  User,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AtSign,
  Wand2,
} from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFinish: () => void
}

const STEPS: {
  title: string
  subtitle: string
  description: string
  icon: typeof LayoutGrid
  badge: string
  tips: string[]
  actionLabel?: string
  targetView?: ViewType
}[] = [
  {
    title: '欢迎来到墨灵写作',
    subtitle: 'AI 驱动的专业网文与长篇小说创作平台',
    description:
      '只需 1 分钟了解核心工作流：从灵感立项、大纲拆解、三栏沉浸式写作到长篇记忆辅助，助你稳定日更。',
    icon: Sparkles,
    badge: '1 / 5 · 概览',
    tips: [
      '顶部单层横向导航可直达：工作台、编辑器、AI 工具箱、广场、设定库与用户中心',
      '右上角「搜索... ⌘K」可快速定位作品与章节，Token 余额与消息通知随时可见',
      '支持日间、深色与护眼三种主题，随时在编辑器右上角切换',
    ],
  },
  {
    title: '工作台：创建与管理你的作品',
    subtitle: '灵感向导 · 文件夹分类 · 进度追踪',
    description:
      '在工作台你可以一键创建新书、导入已有 TXT 小说，并从「继续创作」卡片直接回到上次写作的章节。',
    icon: LayoutGrid,
    badge: '2 / 5 · 工作台',
    tips: [
      '点击「新建作品」可使用 AI 向导，一句话灵感自动生成简介、大纲与主角设定',
      '支持彩色文件夹分类、写作热力图与每日字数目标追踪',
    ],
    actionLabel: '前往工作台',
    targetView: 'workspace',
  },
  {
    title: '三栏编辑器：高效码字与 @ 设定引用',
    subtitle: '目录大纲 · 纯白纸面 · 选中文字 AI 润色',
    description:
      '左栏管理分卷章节、大纲、思维导图与速记；中栏提供纯白无干扰写作画布，并支持待采纳的 AI 草稿块。',
    icon: PenLine,
    badge: '3 / 5 · 编辑器',
    tips: [
      '正文中输入 @ 可直接引用角色、世界观或道具设定，防止吃书',
      '鼠标选中任意段落即可弹出悬浮 AI 条：润色、扩写、缩写、续写、转文风',
      '点击右上角「一键生成」，AI 会以待采纳草稿形式流式写入，不会覆盖原正文',
    ],
  },
  {
    title: '写作 AI 助手：长文记忆与多文件分析',
    subtitle: '黄金三章 · 毒点检查 · @多文件关联',
    description:
      '右侧 AI 助手会自动注入全书大纲、世界观与前情提要，配合内置网文预设指令，帮你诊断节奏、解决卡文。',
    icon: Wand2,
    badge: '4 / 5 · AI 助手',
    tips: [
      '点击预设指令标签（如「黄金三章」「卡文破局」「去 AI 味」）一键分析当前章节',
      '输入 @ 或点击「+ 引用设定」，可同时关联多个章节与角色检查逻辑漏洞',
      'AI 回复支持一键「插入到正文」或「复制」',
    ],
  },
  {
    title: '设定库、AI 工具箱与个人中心',
    subtitle: '完整设定体系 · 独立灵感工具 · 账号设置',
    description:
      '在设定库完善角色/世界观/时间线，在 AI 工具箱拆书起名，并在用户中心管理个人资料、账号安全与会员权益。',
    icon: Settings,
    badge: '5 / 5 · 扩展能力',
    tips: [
      '设定库：统一维护角色档案、世界观、道具法宝与故事时间线',
      'AI 工具箱 & 作品广场：使用提示词市场模板，或将完结/连载章节发布到广场交流',
      '用户中心：修改笔名与密码、查看订单记录或使用兑换码',
    ],
    actionLabel: '查看设定库',
    targetView: 'settings',
  },
]

export function OnboardingDialog({ open, onOpenChange, onFinish }: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const { setView, currentNovelId } = useAppStore()

  const step = STEPS[stepIndex]
  const Icon = step.icon
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  const handleSkip = () => {
    onFinish()
    onOpenChange(false)
    setStepIndex(0)
  }

  const handleComplete = () => {
    onFinish()
    onOpenChange(false)
    setStepIndex(0)
  }

  const handleQuickAction = () => {
    if (step.targetView) {
      if (step.targetView === 'editor' && !currentNovelId) {
        setView('workspace')
      } else {
        setView(step.targetView)
      }
      handleComplete()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onFinish()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[540px] p-0 overflow-hidden gap-0 rounded-[16px]">
        {/* 顶部进度条 */}
        <div className="h-1 w-full bg-muted">
          <div
            className="h-full bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6 space-y-5">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[var(--brand-soft)] text-[var(--brand-ink)] border border-[var(--brand-line)]">
                {step.badge}
              </span>
              <button
                type="button"
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                跳过教程
              </button>
            </div>

            <div className="flex items-start gap-3.5 pt-1">
              <div className="w-11 h-11 rounded-[12px] ai-brand-mark text-white flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold tracking-tight">
                  {step.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {step.subtitle}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <p className="text-sm text-foreground/90 leading-relaxed">
            {step.description}
          </p>

          <div className="rounded-[12px] border border-border bg-[var(--surface-2)] p-3.5 space-y-2.5">
            {step.tips.map((tip) => (
              <div key={tip} className="flex items-start gap-2 text-xs text-foreground/85 leading-relaxed">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span>{tip}</span>
              </div>
            ))}
          </div>

          {/* 步骤圆点 + 底部操作 */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, idx) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => setStepIndex(idx)}
                  aria-label={`第 ${idx + 1} 步`}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === stepIndex
                      ? 'w-5 bg-primary'
                      : 'w-1.5 bg-border hover:bg-muted-foreground/50'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1 rounded-[9px]"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  上一步
                </Button>
              )}

              {step.actionLabel && step.targetView && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-[9px] border-[var(--brand-line)] text-primary hover:bg-[var(--brand-soft)]"
                  onClick={handleQuickAction}
                >
                  {step.actionLabel}
                </Button>
              )}

              {!isLast ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs gap-1 rounded-[9px] bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white border-0"
                  onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
                >
                  下一步
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs gap-1 rounded-[9px] bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white border-0"
                  onClick={handleComplete}
                >
                  开始创作
                  <Sparkles className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
