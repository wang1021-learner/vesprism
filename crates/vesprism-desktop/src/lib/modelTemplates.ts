/**
 * 第三方接入模板：只填官方 [model.*] 已有字段，不另做提供商配置。
 */
import type { ModelInfo } from '../types'
import { autoEnvKey, emptyModelEntry } from './models'

export type ModelVendorId =
  | 'copy'
  | 'xai'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'ollama'
  | 'azure'
  | 'compat'

export type ModelVendorTemplate = {
  id: ModelVendorId
  label: string
  hint: string
  patch: Partial<ModelInfo>
}

export const MODEL_VENDOR_TEMPLATES: ModelVendorTemplate[] = [
  {
    id: 'xai',
    label: 'xAI Grok',
    hint: 'api.x.ai/v1 · 登录账号即可',
    patch: {
      base_url: 'https://api.x.ai/v1',
      api_backend: 'responses',
      env_key: '',
      context_window: 500_000,
      extra_headers: {},
      query_params: {},
      env_http_headers: {},
      supports_reasoning_effort: true,
      reasoning_effort: 'high',
      model: 'grok-4.6',
      name: 'Grok 4.6',
    },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'api.openai.com/v1',
    patch: {
      base_url: 'https://api.openai.com/v1',
      api_backend: 'chat_completions',
      env_key: 'OPENAI_API_KEY',
      context_window: 128_000,
      extra_headers: {},
      query_params: {},
      env_http_headers: {},
      supports_reasoning_effort: false,
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    hint: 'Messages · x-api-key',
    patch: {
      base_url: 'https://api.anthropic.com/v1',
      api_backend: 'messages',
      env_key: 'ANTHROPIC_API_KEY',
      context_window: 200_000,
      extra_headers: { 'anthropic-version': '2023-06-01' },
      query_params: {},
      env_http_headers: { 'x-api-key': 'ANTHROPIC_API_KEY' },
      supports_reasoning_effort: false,
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hint: 'api.deepseek.com（不要 /v1）',
    patch: {
      base_url: 'https://api.deepseek.com',
      api_backend: 'chat_completions',
      env_key: 'DEEPSEEK_API_KEY',
      context_window: 1_000_000,
      extra_headers: {},
      query_params: {},
      env_http_headers: {},
      supports_reasoning_effort: true,
      reasoning_effort: 'high',
      model: 'deepseek-v4-flash',
      name: 'deepseek-v4-flash',
    },
  },
  {
    id: 'ollama',
    label: 'Ollama',
    hint: '本机 11434/v1 · 无需密钥',
    patch: {
      base_url: 'http://localhost:11434/v1',
      api_backend: 'chat_completions',
      env_key: '',
      context_window: 128_000,
      extra_headers: {},
      query_params: {},
      env_http_headers: {},
      supports_reasoning_effort: false,
    },
  },
  {
    id: 'azure',
    label: 'Azure',
    hint: '需 api-version 查询参数',
    patch: {
      base_url: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1',
      api_backend: 'chat_completions',
      env_key: 'AZURE_OPENAI_API_KEY',
      context_window: 128_000,
      extra_headers: {},
      query_params: { 'api-version': '2025-01-01-preview' },
      env_http_headers: {},
      supports_reasoning_effort: false,
    },
  },
  {
    id: 'compat',
    label: '通用兼容',
    hint: 'OpenAI 兼容网关 /v1',
    patch: {
      base_url: 'http://localhost:8080/v1',
      api_backend: 'chat_completions',
      context_window: 128_000,
      extra_headers: {},
      query_params: {},
      env_http_headers: {},
      supports_reasoning_effort: false,
    },
  },
]

export function applyVendorTemplate(
  id: string,
  vendor: ModelVendorId,
  current?: ModelInfo | null,
): ModelInfo {
  if (vendor === 'copy') {
    return emptyModelEntry({
      id,
      model: '',
      name: '',
      base_url: current?.base_url ?? '',
      api_backend: current?.api_backend || 'chat_completions',
      agent_type: current?.agent_type || 'grok-build',
      env_key: current?.env_key ?? '',
      context_window: current?.context_window || 128_000,
      extra_headers: { ...(current?.extra_headers ?? {}) },
      query_params: { ...(current?.query_params ?? {}) },
      env_http_headers: { ...(current?.env_http_headers ?? {}) },
      api_base_url: current?.api_base_url ?? '',
      supports_reasoning_effort: Boolean(current?.supports_reasoning_effort),
      reasoning_effort: current?.supports_reasoning_effort
        ? current.reasoning_effort || ''
        : '',
    })
  }
  const tpl = MODEL_VENDOR_TEMPLATES.find((t) => t.id === vendor)
  const patch = tpl?.patch ?? {}
  const envKey =
    patch.env_key !== undefined ? patch.env_key : autoEnvKey(id)
  return emptyModelEntry({
    id,
    agent_type: current?.agent_type || 'grok-build',
    ...patch,
    env_key: envKey,
  })
}

export function envKeyChoices(models: ModelInfo[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const prefer = [
    'XAI_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
    'AZURE_OPENAI_API_KEY',
  ]
  for (const k of [...prefer, ...models.map((m) => (m.env_key || '').trim())]) {
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** 自定义密钥变量名时的建议，避免拷贝出 M_A8F3K2_API_KEY。 */
export function suggestedEnvKey(model: Pick<ModelInfo, 'id' | 'base_url' | 'env_key'>): string {
  const existing = (model.env_key || '').trim()
  if (existing) return existing
  const url = (model.base_url || '').toLowerCase()
  if (url.includes('deepseek')) return 'DEEPSEEK_API_KEY'
  if (url.includes('anthropic')) return 'ANTHROPIC_API_KEY'
  if (url.includes('azure')) return 'AZURE_OPENAI_API_KEY'
  if (url.includes('openai.com')) return 'OPENAI_API_KEY'
  return autoEnvKey(model.id)
}

export function hostFromBaseUrl(url: string): string {
  const t = url.trim()
  if (!t) return ''
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`)
    return u.host
  } catch {
    return t.replace(/^https?:\/\//, '').split('/')[0] || t
  }
}
