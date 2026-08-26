import type { ModelInfo } from '../types'
import { clampReasoningEffort } from './reasoning'

/** 从模型 id 生成 .env 密钥名：m-abc → M_ABC_API_KEY */
export function autoEnvKey(modelId: string): string {
  const slug = modelId
    .replace(/^m-/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return slug ? `${slug}_API_KEY` : 'MODEL_API_KEY'
}

export function resolveEnvKey(entry: Pick<ModelInfo, 'id' | 'env_key'>): string {
  const k = (entry.env_key || '').trim()
  if (k) return k
  return autoEnvKey(entry.id)
}

export function autoSystemPromptLabel(model: string): string {
  const m = model.trim()
  if (!m) return ''
  return m
}

/** 新建模型草稿；可从模板拷 base_url / api_backend */
export function emptyModelEntry(partial?: Partial<ModelInfo>): ModelInfo {
  const id = partial?.id ?? `m-${Math.random().toString(36).slice(2, 10)}`
  const model = (partial?.model ?? '').trim()
  return {
    id,
    name: model || (partial?.name ?? ''),
    model,
    base_url: partial?.base_url ?? '',
    env_key: partial?.env_key !== undefined ? String(partial.env_key) : autoEnvKey(id),
    context_window: partial?.context_window ?? 128_000,
    system_prompt_label: partial?.system_prompt_label ?? '',
    api_backend: partial?.api_backend || 'chat_completions',
    description: partial?.description ?? '',
    temperature: partial?.temperature ?? null,
    top_p: partial?.top_p ?? null,
    max_completion_tokens: partial?.max_completion_tokens ?? null,
    extra_headers: partial?.extra_headers ?? {},
    query_params: partial?.query_params ?? {},
    env_http_headers: partial?.env_http_headers ?? {},
    api_base_url: partial?.api_base_url ?? '',
    max_retries: partial?.max_retries ?? 0,
    inference_idle_timeout_secs: partial?.inference_idle_timeout_secs ?? 0,
    stream_tool_calls:
      partial?.stream_tool_calls === undefined ? null : partial.stream_tool_calls,
    agent_type: partial?.agent_type || 'grok-build',
    use_concise: Boolean(partial?.use_concise),
    auto_compact_threshold_percent: partial?.auto_compact_threshold_percent ?? 0,
    supports_reasoning_effort: Boolean(partial?.supports_reasoning_effort),
    reasoning_effort: partial?.reasoning_effort || 'medium',
    hidden: Boolean(partial?.hidden),
    supported_in_api: partial?.supported_in_api !== false,
    laziness_enabled: Boolean(partial?.laziness_enabled),
    laziness_max_nudges: partial?.laziness_max_nudges ?? 0,
    compactions_remaining: partial?.compactions_remaining ?? '',
    compaction_at_tokens: partial?.compaction_at_tokens ?? '',
  }
}

/** 从磁盘读回的模型补全缺省字段 */
export function normalizeModelFromDisk(raw: Partial<ModelInfo> & { id: string }): ModelInfo {
  const model = (raw.model || raw.name || '').trim()
  return emptyModelEntry({
    ...raw,
    id: raw.id,
    model,
    name: model || raw.name || raw.id,
    env_key: raw.env_key ?? '',
    context_window:
      typeof raw.context_window === 'number' && raw.context_window > 0
        ? raw.context_window
        : 128_000,
  })
}

/** headers 文本：每行 key: value 或 key=value */
export function headersToText(headers: Record<string, string> | undefined): string {
  if (!headers) return ''
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

export function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const colon = t.indexOf(':')
    const eq = t.indexOf('=')
    let sep = -1
    if (colon >= 0 && (eq < 0 || colon < eq)) sep = colon
    else if (eq >= 0) sep = eq
    if (sep <= 0) continue
    const k = t.slice(0, sep).trim()
    const v = t.slice(sep + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function optNumber(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null
  return v
}

/** 写盘前规范化；失败抛 Error */
export function prepareModelsForSave(models: ModelInfo[]): ModelInfo[] {
  if (models.length === 0) throw new Error('至少需要配置一个模型')
  return models.map((m) => {
    const model = (m.model || m.name || '').trim()
    const id = m.id.trim()
    if (!id) throw new Error('模型 id 不能为空')
    if (!model) throw new Error(`模型「${id}」：API 模型名 (model) 不能为空`)
    if (!m.base_url.trim()) throw new Error(`模型「${model}」：base_url 不能为空`)
    if (!(m.context_window > 0)) {
      throw new Error(`模型「${model}」：请填写上下文窗口（token 数），例如 128000 或 128K`)
    }
    if (m.env_key.trim() && !isValidEnvKeyName(m.env_key)) {
      throw new Error(
        `模型「${model}」：密钥变量名只能用字母、数字和下划线，且须以字母或 _ 开头`,
      )
    }
    const backend = (m.api_backend || 'chat_completions').trim() || 'chat_completions'
    if (!['chat_completions', 'responses', 'messages'].includes(backend)) {
      throw new Error(`模型「${model}」api_backend 无效`)
    }
    const temperature = optNumber(m.temperature)
    if (temperature != null && (temperature < 0 || temperature > 2)) {
      throw new Error(`模型「${model}」：temperature 应在 0–2（空=不设置）`)
    }
    const top_p = optNumber(m.top_p)
    if (top_p != null && (top_p < 0 || top_p > 1)) {
      throw new Error(`模型「${model}」：top_p 应在 0–1（空=不设置）`)
    }
    if (m.auto_compact_threshold_percent > 100) {
      throw new Error(`模型「${model}」：auto_compact_threshold_percent 应在 0–100`)
    }
    for (const [k, v] of Object.entries(m.extra_headers || {})) {
      if (!k.trim()) throw new Error(`模型「${model}」：extra_headers 键不能为空`)
      if (v.includes('\n') || v.includes('\r')) {
        throw new Error(`模型「${model}」：extra_headers 值不能含换行（键 ${k}）`)
      }
    }
    return emptyModelEntry({
      ...m,
      id,
      model,
      name: model,
      env_key: (m.env_key || '').trim(),
      base_url: m.base_url.trim(),
      system_prompt_label:
        (m.system_prompt_label || '').trim() || autoSystemPromptLabel(model),
      api_backend: backend,
      description: (m.description || '').trim(),
      context_window: m.context_window,
      temperature,
      top_p,
      max_completion_tokens:
        m.max_completion_tokens != null && m.max_completion_tokens > 0
          ? m.max_completion_tokens
          : null,
      extra_headers: m.extra_headers || {},
      query_params: m.query_params || {},
      env_http_headers: m.env_http_headers || {},
      api_base_url: (m.api_base_url || '').trim(),
      max_retries: m.max_retries > 0 ? m.max_retries : 0,
      inference_idle_timeout_secs:
        m.inference_idle_timeout_secs > 0 ? m.inference_idle_timeout_secs : 0,
      stream_tool_calls:
        m.stream_tool_calls === undefined ? null : m.stream_tool_calls,
      agent_type: (m.agent_type || 'grok-build').trim() || 'grok-build',
      use_concise: Boolean(m.use_concise),
      auto_compact_threshold_percent:
        m.auto_compact_threshold_percent > 0
          ? Math.min(100, m.auto_compact_threshold_percent)
          : 0,
      supports_reasoning_effort: Boolean(m.supports_reasoning_effort),
      reasoning_effort: m.supports_reasoning_effort
        ? clampReasoningEffort(model, m.base_url, m.reasoning_effort)
        : '',
      hidden: Boolean(m.hidden),
      supported_in_api: m.supported_in_api !== false,
      laziness_enabled: Boolean(m.laziness_enabled),
      laziness_max_nudges: m.laziness_max_nudges > 0 ? m.laziness_max_nudges : 0,
      compactions_remaining: (m.compactions_remaining || '').trim(),
      compaction_at_tokens: (m.compaction_at_tokens || '').trim(),
    })
  })
}

export function modelDisplayName(m: Pick<ModelInfo, 'model' | 'name' | 'id'>): string {
  return (m.model || m.name || m.id).trim() || m.id
}

export function isValidEnvKeyName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())
}

/** 保存时用「设为默认」的 id，不要把当前正在编辑的条目偷偷写成默认。 */
export function resolveDefaultModelId(
  defaultId: string,
  selectedId: string,
  ids: string[],
): string {
  const d = defaultId.trim()
  if (d && ids.includes(d)) return d
  const s = selectedId.trim()
  if (s && ids.includes(s)) return s
  return ids[0] ?? ''
}

export const CONTEXT_WINDOW_PRESETS: { label: string; tokens: number }[] = [
  { label: '32K', tokens: 32_000 },
  { label: '128K', tokens: 128_000 },
  { label: '200K', tokens: 200_000 },
  { label: '1M', tokens: 1_000_000 },
]

/**
 * 上下文窗口输入：可填 128K / 1M / 128000。
 * 纯数字小于 10000 按「千 token」（兼容旧的 K 栏）；≥10000 按 token 原文，
 * 避免把文档里的 128000 再乘一千变成 1.28 亿。
 */
export function parseContextWindowInput(raw: string): number {
  const t = raw.trim().toLowerCase().replace(/,/g, '').replace(/_/g, '').replace(/\s+/g, '')
  if (!t) return 0
  const million = t.match(/^(\d+(?:\.\d+)?)m(?:illion)?(?:tokens?)?$/)
  if (million) return Math.round(Number(million[1]) * 1_000_000)
  const kilo = t.match(/^(\d+(?:\.\d+)?)k(?:tokens?)?$/)
  if (kilo) return Math.round(Number(kilo[1]) * 1000)
  const n = Number(t.replace(/tokens?/g, ''))
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n < 10_000) return Math.round(n) * 1000
  return Math.round(n)
}

export function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}M tokens`
  }
  if (tokens >= 1000 && tokens % 1000 === 0) {
    return `${tokens / 1000}K tokens`
  }
  return `${tokens.toLocaleString()} tokens`
}

/** 配错时的即时提示；不替代保存校验。 */
export function modelSetupWarnings(m: ModelInfo): string[] {
  const w: string[] = []
  const url = m.base_url.trim()
  const urlLc = url.toLowerCase()
  if (urlLc.includes('api.deepseek.com') && /\/v1\/?$/.test(urlLc)) {
    w.push('DeepSeek 官方地址不要加 /v1，请用 https://api.deepseek.com')
  }
  if (
    (urlLc.includes('api.openai.com') || urlLc.includes('localhost:11434')) &&
    urlLc.length > 0 &&
    !/\/v1\/?$/.test(urlLc.split('?')[0] || '')
  ) {
    w.push('OpenAI / Ollama 的 Base URL 通常以 /v1 结尾')
  }
  if (m.api_backend === 'messages' && urlLc && !urlLc.includes('anthropic')) {
    w.push('Messages 协议主要用于 Anthropic 官方。多数网关应选 Chat Completions。')
  }
  if (m.api_backend === 'chat_completions' && urlLc.includes('api.anthropic.com')) {
    w.push('Anthropic 官方应选 Messages，并在高级选项里保留 anthropic-version 请求头')
  }
  if (
    urlLc.includes('openai.azure.com') &&
    !Object.keys(m.query_params || {}).some((k) => k.toLowerCase() === 'api-version')
  ) {
    w.push('Azure 需要在高级选项的查询参数里写 api-version')
  }
  if (m.env_key.trim() && !isValidEnvKeyName(m.env_key)) {
    w.push('密钥变量名只能用字母、数字和下划线，且须以字母或 _ 开头')
  }
  return w
}
