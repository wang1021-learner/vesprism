/**
 * 推理档位：与桌面 commands.rs 的 looks_like_deepseek / reasoning_efforts_for
 * / default_reasoning_effort_for 对齐。设置页默认档、输入栏菜单、新会话 spawn
 * 都走这里，避免 DeepSeek 仍露出 medium/xhigh 或默认成 medium。
 */
import type { ModelInfo, ReasoningEffort } from '../types'
import { REASONING_LEVELS } from '../types'

const DEEPSEEK_EFFORTS: readonly ReasoningEffort[] = ['low', 'high', 'max']
const DEFAULT_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function looksLikeDeepSeek(model: string, baseUrl: string): boolean {
  const m = model.trim().toLowerCase()
  const url = baseUrl.trim().toLowerCase()
  return m.startsWith('deepseek-') || url.includes('api.deepseek.com')
}

export function reasoningEffortValuesFor(
  model: string,
  baseUrl: string,
): readonly ReasoningEffort[] {
  return looksLikeDeepSeek(model, baseUrl) ? DEEPSEEK_EFFORTS : DEFAULT_EFFORTS
}

export function defaultReasoningEffortFor(
  model: string,
  baseUrl: string,
  raw: string,
): ReasoningEffort {
  const normalized = raw.trim().toLowerCase()
  if (looksLikeDeepSeek(model, baseUrl)) {
    if (normalized === 'low' || normalized === 'high' || normalized === 'max') {
      return normalized
    }
    return 'high'
  }
  if (!normalized) return 'medium'
  if ((DEFAULT_EFFORTS as readonly string[]).includes(normalized)) {
    return normalized as ReasoningEffort
  }
  return 'medium'
}

export function clampReasoningEffort(
  model: string,
  baseUrl: string,
  raw: string,
): ReasoningEffort {
  const allowed = reasoningEffortValuesFor(model, baseUrl)
  const n = raw.trim().toLowerCase()
  if ((allowed as readonly string[]).includes(n)) return n as ReasoningEffort
  return defaultReasoningEffortFor(model, baseUrl, n)
}

/** 输入栏展示的档位（Messages 协议静默忽略 none/minimal，这里一并藏掉） */
export function reasoningLevelsFor(opts: {
  model: string
  baseUrl: string
  apiBackend?: string
}): { value: ReasoningEffort; label: string }[] {
  let values = reasoningEffortValuesFor(opts.model, opts.baseUrl)
  if (opts.apiBackend === 'messages') {
    values = values.filter((v) => v !== 'none' && v !== 'minimal')
  }
  return REASONING_LEVELS.filter((lv) => values.includes(lv.value))
}

export function reasoningEffortLabel(value: string): string {
  return REASONING_LEVELS.find((lv) => lv.value === value)?.label || value
}

export function spawnReasoningEffort(
  entry:
    | Pick<
        ModelInfo,
        'model' | 'base_url' | 'supports_reasoning_effort' | 'reasoning_effort'
      >
    | undefined,
  fallback?: string,
): string | undefined {
  if (!entry?.supports_reasoning_effort) {
    const fb = (fallback || '').trim()
    return fb || undefined
  }
  return clampReasoningEffort(
    entry.model,
    entry.base_url,
    entry.reasoning_effort || fallback || '',
  )
}
