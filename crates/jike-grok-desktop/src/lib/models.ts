import type { ModelInfo } from '../types'

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
    env_key: partial?.env_key ?? autoEnvKey(id),
    context_window: partial?.context_window ?? 128_000,
    system_prompt_label: partial?.system_prompt_label ?? '',
    api_backend: partial?.api_backend || 'chat_completions',
    description: partial?.description ?? '',
    temperature: partial?.temperature ?? null,
    top_p: partial?.top_p ?? null,
    max_completion_tokens: partial?.max_completion_tokens ?? null,
    extra_headers: partial?.extra_headers ?? {},
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
    env_key: raw.env_key || autoEnvKey(raw.id),
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
      throw new Error(`模型「${model}」：请填写上下文窗口（token 数），例如 128000`)
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
      env_key: resolveEnvKey({ id, env_key: m.env_key }),
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
        ? (m.reasoning_effort || 'medium').trim() || 'medium'
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
