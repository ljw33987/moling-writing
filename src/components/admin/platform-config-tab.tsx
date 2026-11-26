/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/helpers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, Settings, Cpu, Plus, Trash2, Coins, Gift, Sparkles, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AI_PROVIDERS } from '@/lib/ai-providers'
import { DEFAULT_MODEL_MAPPINGS, type AdminModelMapping } from '@/lib/ai-models'

export function PlatformConfigTab() {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [packages, setPackages] = useState<any[]>([])

  // 表单
  const [platformName, setPlatformName] = useState('')
  const [platformIcon, setPlatformIcon] = useState('')
  const [platformDesc, setPlatformDesc] = useState('')
  const [mode, setMode] = useState('paid')
  const [rechargeEnabled, setRechargeEnabled] = useState(true)
  const [registerTokens, setRegisterTokens] = useState(10000)
  // AI
  const [aiProvider, setAiProvider] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [modelMappings, setModelMappings] = useState<AdminModelMapping[]>(DEFAULT_MODEL_MAPPINGS)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api('/api/admin/platform-config')
      setConfig(r.config)
      setPlatformName(r.config.platformName)
      setPlatformIcon(r.config.platformIcon)
      setPlatformDesc(r.config.platformDesc)
      setMode(r.config.mode)
      setRechargeEnabled(r.config.rechargeEnabled)
      setRegisterTokens(r.config.registerTokens)
      setAiProvider(r.config.defaultAiProvider)
      setAiApiKey('')
      setAiBaseUrl(r.config.defaultAiBaseUrl)
      setAiModel(r.config.defaultAiModel)
      setPackages(r.config.customPackages || [])
      if (Array.isArray(r.config.modelMappings) && r.config.modelMappings.length > 0) {
        setModelMappings(r.config.modelMappings)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api('/api/admin/platform-config', {
        method: 'POST',
        body: JSON.stringify({
          platformName, platformIcon, platformDesc,
          mode, rechargeEnabled, customPackages: packages,
          registerTokens,
          defaultAiProvider: aiProvider,
          defaultAiApiKey: aiApiKey || undefined,
          defaultAiBaseUrl: aiBaseUrl,
          defaultAiModel: aiModel,
          modelMappings,
        }),
      })
      toast.success('配置已保存')
      setAiApiKey('')
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  // 套餐管理
  const addPackage = () => {
    setPackages([...packages, { id: `pkg_${Date.now()}`, tokens: 50000, price: 9.9, name: '新套餐', popular: false }])
  }
  const updatePackage = (idx: number, field: string, value: any) => {
    setPackages(packages.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }
  const removePackage = (idx: number) => {
    setPackages(packages.filter((_, i) => i !== idx))
  }

  const addModelMapping = () => {
    setModelMappings([
      ...modelMappings,
      {
        aliasId: `moling_v4_${modelMappings.length + 1}`,
        displayName: `moling_v4_${modelMappings.length + 1}`,
        badge: '标准',
        description: '自定义映射模型',
        provider: aiProvider || 'deepseek',
        baseUrl: '',
        apiKey: '',
        realModel: '',
        enabled: true,
      },
    ])
  }

  const updateModelMapping = (idx: number, field: keyof AdminModelMapping, value: any) => {
    setModelMappings(
      modelMappings.map((m, i) => {
        if (i !== idx) return m
        const next = { ...m, [field]: value }
        if (field === 'provider') {
          const preset = AI_PROVIDERS[value as string]
          if (preset) {
            if (!next.baseUrl) next.baseUrl = preset.baseUrl
            if (!next.realModel) next.realModel = preset.defaultModel
          }
        }
        return next
      })
    )
  }

  const removeModelMapping = (idx: number) => {
    setModelMappings(modelMappings.filter((_, i) => i !== idx))
  }

  const onProviderChange = (p: string) => {
    setAiProvider(p)
    const preset = AI_PROVIDERS[p]
    if (preset) {
      setAiBaseUrl(preset.baseUrl)
      setAiModel(preset.defaultModel)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* 平台基础配置 */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings className="w-4 h-4" />平台基础配置</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">平台名称</Label>
              <Input value={platformName} onChange={(e) => setPlatformName(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">平台图标 URL（可选）</Label>
              <Input value={platformIcon} onChange={(e) => setPlatformIcon(e.target.value)} placeholder="https://..." className="h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">平台描述</Label>
            <Input value={platformDesc} onChange={(e) => setPlatformDesc(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">平台模式</Label>
            <div className="flex gap-2">
              <Button size="sm" variant={mode === 'paid' ? 'default' : 'outline'} onClick={() => setMode('paid')} className="gap-1.5">
                <Coins className="w-3.5 h-3.5" /> 付费模式（Token 积分制）
              </Button>
              <Button size="sm" variant={mode === 'free' ? 'default' : 'outline'} onClick={() => setMode('free')} className="gap-1.5">
                <Gift className="w-3.5 h-3.5" /> 免费模式（无限使用）
              </Button>
            </div>
            {mode === 'free' && (
              <p className="text-[10px] text-amber-600">⚠ 免费模式下所有用户可无限使用 AI，不消耗 Token</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">注册赠送字数（自动按 3 字 ≈ 1 Token 换算）</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step={3000}
                value={registerTokens * 3}
                onChange={(e) => setRegisterTokens(Math.max(0, Math.ceil(Number(e.target.value) / 3)))}
                className="h-9 w-48"
              />
              <span className="text-xs text-muted-foreground">
                字（≈ {registerTokens.toLocaleString()} Token）
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 充值配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="w-4 h-4" />充值配置
            <Badge variant="outline" className="ml-auto text-xs">
              {rechargeEnabled ? '已启用' : '已禁用'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={rechargeEnabled} onChange={(e) => setRechargeEnabled(e.target.checked)} />
            <span className="text-sm">启用充值功能</span>
          </label>

          {rechargeEnabled && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs">充值套餐（按字数配置，自动换算为 Token：3 字 ≈ 1 Token）</Label>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addPackage}>
                  <Plus className="w-3 h-3" /> 添加套餐
                </Button>
              </div>
              {packages.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded">
                  暂无自定义套餐，将使用默认套餐（15万字¥9.9 / 60万字¥29.9 / 300万字¥99.9）
                </div>
              ) : (
                <div className="space-y-2">
                  {packages.map((p, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 p-2 border rounded-lg">
                      <Input placeholder="套餐名" value={p.name} onChange={(e) => updatePackage(i, 'name', e.target.value)} className="h-8 text-xs w-28" />
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step={10000}
                          placeholder="充值字数"
                          value={Math.round((p.tokens || 0) * 3)}
                          onChange={(e) => updatePackage(i, 'tokens', Math.max(1, Math.ceil(Number(e.target.value) / 3)))}
                          className="h-8 text-xs w-32"
                        />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          字 (≈{(p.tokens || 0).toLocaleString()} Token)
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">¥</span>
                        <Input type="number" step="0.1" placeholder="价格" value={p.price} onChange={(e) => updatePackage(i, 'price', Number(e.target.value))} className="h-8 text-xs w-20" />
                      </div>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="checkbox" checked={p.popular} onChange={(e) => updatePackage(i, 'popular', e.target.checked)} />
                        推荐
                      </label>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => removePackage(i)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 平台默认 AI 配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="w-4 h-4" />平台默认 AI 配置
            {config?.hasApiKey ? (
              <Badge variant="outline" className="ml-auto text-xs text-emerald-600">已配置</Badge>
            ) : (
              <Badge variant="outline" className="ml-auto text-xs text-amber-600">未配置</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded p-3 text-xs text-blue-700 dark:text-blue-300">
            <Sparkles className="w-3 h-3 inline mr-1" />
            配置后，未绑定自己 API 的用户将使用此 AI 模型（消耗平台 Token）。
            AI 调用优先级：用户自定义 API {'>'} 平台默认 AI {'>'} 内置 z-ai
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">AI 提供商</Label>
            <Select value={aiProvider} onValueChange={onProviderChange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="选择提供商（留空则使用内置）" /></SelectTrigger>
              <SelectContent>
                {Object.values(AI_PROVIDERS).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {aiProvider && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">API Key {config?.hasApiKey && '（已设置，留空保留）'}</Label>
                <Input type="password" value={aiApiKey} onChange={(e) => setAiApiKey(e.target.value)} placeholder={config?.hasApiKey ? '****（已设置）' : 'sk-...'} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL</Label>
                <Input value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} className="h-9 font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">模型</Label>
                {AI_PROVIDERS[aiProvider]?.models?.length > 0 ? (
                  <Select value={aiModel} onValueChange={setAiModel}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AI_PROVIDERS[aiProvider].models.map((m: string) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} className="h-9 font-mono text-xs" />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 对外模型映射（隐藏 deepseek-chat / minimax 等真实名称） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            对外模型映射（隐藏底层接口名称）
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 ml-auto" onClick={addModelMapping}>
              <Plus className="w-3 h-3" /> 新增映射
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded p-3 text-xs text-emerald-700 dark:text-emerald-300">
            用户在写作助手下拉框中只会看到「对外名称」（如 <code className="font-mono">moling_v4</code>、<code className="font-mono">moling_v4_pro</code>），
            不会暴露底层的 <code className="font-mono">deepseek-chat</code>、<code className="font-mono">MiniMax-M2.7</code> 等真实模型名称。
            实际 Base URL / API Key 留空时默认继承上方「平台默认 AI 配置」。
          </div>

          <div className="space-y-3">
            {modelMappings.map((m, idx) => (
              <div key={idx} className="border rounded-lg p-3 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-xs">{m.aliasId || '未命名'}</Badge>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={m.enabled !== false}
                        onChange={(e) => updateModelMapping(idx, 'enabled', e.target.checked)}
                      />
                      启用
                    </label>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!m.isPro}
                        onChange={(e) => updateModelMapping(idx, 'isPro', e.target.checked)}
                      />
                      Pro 深度模式
                    </label>
                  </div>
                  {modelMappings.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-red-600"
                      onClick={() => removeModelMapping(idx)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">对外接口名（用户可见）</Label>
                    <Input
                      value={m.aliasId}
                      onChange={(e) => {
                        updateModelMapping(idx, 'aliasId', e.target.value)
                        updateModelMapping(idx, 'displayName', e.target.value)
                      }}
                      placeholder="如：moling_v4"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">标签</Label>
                    <Input
                      value={m.badge}
                      onChange={(e) => updateModelMapping(idx, 'badge', e.target.value)}
                      placeholder="如：标准 / 增强"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">功能简介</Label>
                    <Input
                      value={m.description}
                      onChange={(e) => updateModelMapping(idx, 'description', e.target.value)}
                      placeholder="日常对话与续写"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 border-t border-border/50">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">实际提供商（后台隐藏）</Label>
                    <Select value={m.provider || ''} onValueChange={(v) => updateModelMapping(idx, 'provider', v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="继承平台默认" /></SelectTrigger>
                      <SelectContent>
                        {Object.values(AI_PROVIDERS).map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">实际模型名（后台隐藏）</Label>
                    <Input
                      value={m.realModel}
                      onChange={(e) => updateModelMapping(idx, 'realModel', e.target.value)}
                      placeholder="如：deepseek-chat / MiniMax-M2.7"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">独立 Base URL（可选）</Label>
                    <Input
                      value={m.baseUrl}
                      onChange={(e) => updateModelMapping(idx, 'baseUrl', e.target.value)}
                      placeholder="留空继承平台默认"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">独立 API Key（可选）</Label>
                    <Input
                      type="password"
                      value={m.apiKey}
                      onChange={(e) => updateModelMapping(idx, 'apiKey', e.target.value)}
                      placeholder="留空继承平台默认"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5 shadow-lg">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存配置
        </Button>
      </div>
    </div>
  )
}
