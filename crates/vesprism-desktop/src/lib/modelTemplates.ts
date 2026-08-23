/**
 * 第三方接入模板：只填官方 [model.*] 已有字段，不另做提供商配置。
 */
import type { ModelInfo } from '../types'
import { autoEnvKey, emptyModelEntry } from './models'

export type ModelVendorId =
  | 'copy'
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
      context_window: current?.context_window || 128_000,
      extra_headers: {},
      query_params: {},
      env_http_headers: {},
      supports_reasoning_effort: false,
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
