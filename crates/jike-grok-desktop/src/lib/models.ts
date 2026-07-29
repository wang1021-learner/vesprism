import { emptyModelEntry, type ModelEntry } from '../types'

/**
 * 由配置 id 自动生成合法环境变量名（用户无需填写 env_key）。
 * 规则与后端 validate_env_key_name 一致：字母/下划线开头，仅 [A-Za-z0-9_]。
 */
export function autoEnvKey(modelId: string): string {
  const body = modelId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  const safe = body && /^[A-Z_]/.test(body) ? body : `M_${body || 'DEFAULT'}`
  return `JIKE_${safe}_API_KEY`
}

/** 已有 env_key 则保留（兼容旧配置）；否则按模型 id 自动生成 */
export function resolveEnvKey(entry: { id: string; env_key?: string }): string {
  const existing = entry.env_key?.trim()
  if (existing) return existing
  return autoEnvKey(entry.id)
}

/** 后端可能缺新字段，统一补齐默认值 */
export function normalizeModelFromDisk(m: ModelEntry): ModelEntry {
  const model = (m.model || '').trim()
  return emptyModelEntry({
    ...m,
    id: m.id,
    model,
    name: model, // 展示名 = 模型名称
    env_key: resolveEnvKey(m),
    api_backend: m.api_backend || 'chat_completions',
    description: m.description ?? '',
    // null = 未配置；保留 0 作为合法采样值（与旧「0=不写盘」区分：缺省才 null）
    temperature:
      m.temperature === undefined || m.temperature === null ? null : m.temperature,
    top_p: m.top_p === undefined || m.top_p === null ? null : m.top_p,
    max_completion_tokens:
      m.max_completion_tokens === undefined || m.max_completion_tokens === null
        ? null
        : m.max_completion_tokens,
    extra_headers: m.extra_headers ?? {},
    api_base_url: m.api_base_url ?? '',
    max_retries: m.max_retries ?? 0,
    inference_idle_timeout_secs: m.inference_idle_timeout_secs ?? 0,
    stream_tool_calls:
      m.stream_tool_calls === undefined ? null : m.stream_tool_calls,
    agent_type: m.agent_type || 'grok-build',
    use_concise: Boolean(m.use_concise),
    auto_compact_threshold_percent: m.auto_compact_threshold_percent ?? 0,
    supports_reasoning_effort: Boolean(m.supports_reasoning_effort),
    reasoning_effort: m.reasoning_effort || (m.supports_reasoning_effort ? 'medium' : ''),
    hidden: Boolean(m.hidden),
    supported_in_api: m.supported_in_api !== false,
    laziness_enabled: Boolean(m.laziness_enabled),
    laziness_max_nudges: m.laziness_max_nudges ?? 0,
    compactions_remaining: m.compactions_remaining ?? '',
    compaction_at_tokens: m.compaction_at_tokens ?? '',
  })
}

/** 系统提示标签：API 模型 ID + 固定后缀，用户无需填写 */
export const SYSTEM_PROMPT_LABEL_SUFFIX = '（基于 xAI Grok Build 二次开发框架驱动）'

export function autoSystemPromptLabel(apiModelId: string): string {
  const base = apiModelId.trim()
  if (!base) return ''
  return `${base}${SYSTEM_PROMPT_LABEL_SUFFIX}`
}
