/**
 * Grok Build 桌面端 — 共享类型
 */

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'thought' | 'tool'
  text: string
  tool?: string
  toolCallId?: string
  /** 用户消息关联的 prompt（用于分片合并 / 乐观 UI） */
  promptId?: string
  isStreaming?: boolean
  thoughtTiming?: { start: number; end?: number }
}

export interface PermissionRequest {
  id: string
  tool: string
  args: Record<string, unknown>
  message: string
}

/** 对齐后端 ModelEntryDto（serde snake_case） */
export interface ModelInfo {
  id: string
  name: string
  model: string
  base_url: string
  env_key: string
  context_window: number
  system_prompt_label: string
  api_backend: string
  description: string
  temperature: number | null
  top_p: number | null
  max_completion_tokens: number | null
  extra_headers: Record<string, string>
  api_base_url: string
  max_retries: number
  inference_idle_timeout_secs: number
  stream_tool_calls: boolean | null
  agent_type: string
  use_concise: boolean
  auto_compact_threshold_percent: number
  supports_reasoning_effort: boolean
  reasoning_effort: string
  hidden: boolean
  supported_in_api: boolean
  laziness_enabled: boolean
  laziness_max_nudges: number
  compactions_remaining: string
  compaction_at_tokens: string
  provider?: string
}

export type SessionStatus = 'unknown' | 'initializing' | 'idle' | 'generating' | 'ended'

export type SessionPhase = 'idle' | 'booting' | 'ready' | 'restarting' | 'loading' | 'failed'

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const REASONING_LEVELS: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
]
