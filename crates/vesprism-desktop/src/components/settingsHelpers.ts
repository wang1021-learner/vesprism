export type SettingsTab = 'general' | 'models' | 'security'

export type ApiBackend = 'chat_completions' | 'responses' | 'messages'

export const API_BACKENDS: { value: ApiBackend; label: string; hint: string }[] = [
  {
    value: 'chat_completions',
    label: 'Chat Completions',
    hint: 'OpenAI 兼容 /v1/chat/completions（DeepSeek、Ollama、多数厂商）',
  },
  {
    value: 'responses',
    label: 'Responses',
    hint: 'OpenAI Responses /v1/responses',
  },
  {
    value: 'messages',
    label: 'Messages',
    hint: 'Anthropic Messages /v1/messages',
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
