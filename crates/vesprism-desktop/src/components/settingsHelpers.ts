export type SettingsTab =
  | 'general'
  | 'models'
  | 'security'
  | 'engine'
  | 'hooks'
  | 'skills'
  | 'tools'
  | 'mcp'
  | 'memory'
  | 'plugins'

export type ApiBackend = 'chat_completions' | 'responses' | 'messages'

export const API_BACKENDS: { value: ApiBackend; label: string; hint: string }[] = [
  {
    value: 'chat_completions',
    label: 'Chat Completions',
    hint: '多数第三方（DeepSeek、Ollama、兼容网关）。选错会 404。',
  },
  {
    value: 'responses',
    label: 'Responses',
    hint: 'OpenAI 新接口 /v1/responses，普通兼容网关不要选。',
  },
  {
    value: 'messages',
    label: 'Messages',
    hint: 'Anthropic 官方。兼容网关几乎都不是这个。',
  },
]

export function headersToText(headers: Record<string, string> | undefined): string {
  if (!headers) return ''
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

export function textToHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (key) out[key] = value
  }
  return out
}
