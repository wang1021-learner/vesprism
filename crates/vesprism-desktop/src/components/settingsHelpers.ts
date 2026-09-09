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

/** 设置保存后的诚实回执：模型热加载，引擎/Hooks 只写盘。 */
export function settingsSavedMessage(kind: 'models' | 'engine' | 'hooks'): string {
  switch (kind) {
    case 'models':
      return '模型已保存。密钥在 .env，其余在 config.toml。当前会话已重载模型列表。'
    case 'engine':
      return '引擎设置已写入 config.toml。新开会话生效；当前这场要重启 Vesprism。'
    case 'hooks':
      return 'Hooks 已写入 config.toml。新开会话生效；当前这场点「重载」或重启 Vesprism。'
  }
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
