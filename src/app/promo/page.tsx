'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Sparkles,
  BookOpen,
  Layers,
  GitBranch,
  ShieldCheck,
  Zap,
  ArrowRight,
  Check,
  Flame,
  Feather,
  Lock,
} from 'lucide-react'

export default function PromoPage() {
  const [compareMode, setCompareMode] = useState<'ai' | 'baogeng'>('baogeng')

  return (
    <div className="min-h-screen bg-[#07080D] text-[#F3F2EE] selection:bg-indigo-500/30">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#07080D]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto h-16 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', color: '#ffffff' }}
              className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shadow-lg shadow-indigo-500/30"
            >
              BG
            </div>
            <div>
              <div className="font-bold text-base tracking-tight leading-none">爆更猫 AI 写作</div>
              <div className="text-[11px] text-zinc-400 mt-1">长篇网文创作引擎</div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
            <a href="#de-ai" className="hover:text-white transition">去 AI 味实测</a>
            <a href="#codex" className="hover:text-white transition">Codex 记忆引擎</a>
            <a href="#pricing" className="hover:text-white transition">会员与套餐</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)', color: '#ffffff' }}
              className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center gap-1.5 shadow-lg shadow-indigo-500/25"
            >
              立即开写
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero 首屏 */}
      <section className="relative overflow-hidden pt-20 pb-24 px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.22),transparent_60%)] pointer-events-none" />
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-6">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>专为中文签约网文作者打造 · v4 与 Pro 双引擎</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.15]">
            写长篇不吃书，
            <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-amber-300 bg-clip-text text-transparent">
              字字像人手写
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            把大纲、人物卡、世界观、时间线和前文脉络自动装进每一段创作。
            拒绝“空气仿佛凝固”“心中五味杂陈”的塑料 AI 腔，日更万字也能保持签约级文风。
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/"
              style={{ backgroundColor: '#ffffff', color: '#09090b' }}
              className="px-7 py-3.5 rounded-xl font-semibold text-sm hover:opacity-90 transition flex items-center gap-2 shadow-xl"
            >
              <Feather className="w-4 h-4" />
              免费领 1 万 Token 开始试写
            </Link>
            <a
              href="#de-ai"
              className="px-7 py-3.5 rounded-xl font-semibold text-sm border border-white/15 bg-white/5 hover:bg-white/10 transition text-zinc-200"
            >
              体验“去 AI 味”对比
            </a>
          </div>
        </div>
      </section>

      {/* 互动演示：AI 味粉碎机 */}
      <section id="de-ai" className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-[#0F111A] p-6 sm:p-10 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  同一段大纲，两种完全不同的文笔
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  点击右侧按钮切换，直观对比「普通 AI」与「爆更猫去 AI 味引擎」的差距
                </p>
              </div>
              <div className="inline-flex rounded-xl bg-black/40 p-1 border border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={() => setCompareMode('ai')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                    compareMode === 'ai'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  普通 AI 套话腔
                </button>
                <button
                  type="button"
                  onClick={() => setCompareMode('baogeng')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                    compareMode === 'baogeng'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  爆更猫人类手写腔
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-xs space-y-2">
                <div className="text-zinc-400 font-medium">输入指令 · 核心事件</div>
                <p className="text-zinc-300 leading-relaxed">
                  主角林川摸黑进破庙躲雨，碰见一个受伤的旧识剑客。要求：不能出现“空气凝固”“五味杂陈”等套话，靠动作和细节推进。
                </p>
              </div>

              <div className="md:col-span-2 rounded-xl bg-black/40 border border-white/10 p-5">
                {compareMode === 'ai' ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-rose-400 font-semibold">❌ 常见 AI 输出（极易被平台拒签）</span>
                      <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300">AI 味指数 92</span>
                    </div>
                    <p className="text-sm leading-8 text-zinc-300">
                      林川缓缓推开破庙的大门，空气仿佛在这一刻凝固了。看到角落里浑身是血的故人，他心中五味杂陈，不由自主地深吸了一口气。他的眼神微微一眯，嘴角露出一抹苦笑：“没想到我们会在这种地方重逢。”然而，命运的齿轮已经开始悄悄转动……
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-400 font-semibold">✅ 爆更猫去 AI 味输出（自然、有呼吸感）</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">AI 味指数 8</span>
                    </div>
                    <p className="text-sm leading-8 text-zinc-100">
                      庙门烂了一半，风裹着雨星子往里灌。林川把湿透的蓑衣甩在门槛外，刚要摸火折子，供桌底下突然踢出来半截剑鞘。“别点火。”里头那人声音哑得像砂纸磨石头，喘了两口才接着道，“火光一起，山下那帮狗鼻子就能顺着烟摸上来。”
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 核心能力矩阵 */}
      <section id="codex" className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold">为长篇连载打磨的 4 大硬核底座</h2>
            <p className="text-sm text-zinc-400 mt-2">不止会续写，更能帮你管住几十万字的大纲与伏笔</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="rounded-2xl border border-white/10 bg-[#0F111A] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base">Codex 分层记忆</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                大纲 → @引用设定 → 时间线 → 前情摘要 → 上一章最后 3 段原文，自动分层装配，写到 50 万字也不吃书。
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0F111A] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base">18 套签约提示词</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                爽点兑现三段式、章末翻页钩子、人物小传、段落去 AI 味洗稿，拒绝废话模板，直接交付可用正文。
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0F111A] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                <GitBranch className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base">分支讨论 + 安全草稿</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                每条回复都能开独立分支推演再合并主线；生成内容先入紫色「待采纳草稿块」，永不误覆盖原稿。
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0F111A] p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-fuchsia-500/15 text-fuchsia-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base">三层防丢稿护航</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                本地 IndexedDB 秒级暂存 + 云端自动同步 + 历史版本快照，断网断电也不丢一个标点符号。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 套餐定价 */}
      <section id="pricing" className="py-16 px-6 border-t border-white/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold">简单透明的会员方案</h2>
            <p className="text-sm text-zinc-400 mt-2">免费版即可体验 v4 标准引擎，月卡 / 年卡解锁 Pro 深度精修模型</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-white/10 bg-[#0F111A] p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <div className="text-sm font-semibold text-zinc-300">免费体验版</div>
                <div className="text-3xl font-extrabold">¥0</div>
                <ul className="space-y-2.5 text-xs text-zinc-400 pt-2">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 注册即送 10,000 Token</li>
                  <li className="flex items-center gap-2"><Zap className="w-4 h-4 text-indigo-400" /> 支持 baogeng_v4 标准模型</li>
                  <li className="flex items-center gap-2"><Lock className="w-4 h-4 text-zinc-500" /> 不含 Pro 深度精修模型</li>
                </ul>
              </div>
              <Link href="/" className="w-full py-2.5 rounded-xl border border-white/15 text-center text-xs font-semibold hover:bg-white/5 transition">
                免费注册体验
              </Link>
            </div>

            <div className="rounded-2xl border-2 border-indigo-500 bg-gradient-to-b from-indigo-500/15 to-[#0F111A] p-6 flex flex-col justify-between space-y-6 shadow-xl shadow-indigo-500/10">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-indigo-300">月卡会员</span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500 text-white text-[10px] font-bold">推荐</span>
                </div>
                <div className="text-3xl font-extrabold">¥29.9 <span className="text-xs font-normal text-zinc-400">/ 月</span></div>
                <ul className="space-y-2.5 text-xs text-zinc-300 pt-2">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 解锁 baogeng_v4_pro 增强模型</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 无限小说数量 + 专属文风提取</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 赠送 15 万字数额度</li>
                </ul>
              </div>
              <Link href="/" className="w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-center text-xs font-semibold transition">
                立即开通月卡
              </Link>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-[#0F111A] p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <div className="text-sm font-semibold text-amber-300">年卡会员</div>
                <div className="text-3xl font-extrabold">¥299 <span className="text-xs font-normal text-zinc-400">/ 年</span></div>
                <ul className="space-y-2.5 text-xs text-zinc-300 pt-2">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 月卡全部权益 + Pro 优先通道</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 赠送 60 万字数额度</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 优先体验新功能与专属支持</li>
                </ul>
              </div>
              <Link href="/" className="w-full py-2.5 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-center text-xs font-semibold transition">
                立即开通年卡
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8 px-6 text-center text-xs text-zinc-500">
        © 2026 BG · 爆更猫AI写作 · 为长篇网文创作者而生
      </footer>
    </div>
  )
}
