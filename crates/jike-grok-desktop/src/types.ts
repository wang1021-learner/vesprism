/**
 * Grok Build 桌面端 — 共享类型
 */

/** 工具调用中的结构化 diff（与后端 ToolDiffInfo camelCase 对齐） */
export type ToolDiffData = {
  path: string
  oldText?: string | null
  newText: string
}

/** 工具调用数据（与后端 ToolCallInfo camelCase 对齐） */
export type ToolCallData = {
  toolCallId: string
  /** read / edit / execute / search / fetch / delete / move / think / other */
  kind: string
  /** pending / in_progress / completed / failed */
  status: string
  title: string
  /** 路径、命令等摘要 */
  detail: string
  /** 输出预览（截断） */
  preview: string
  diffs?: ToolDiffData[]
  /** 前端计时（耗时展示） */
  timing?: { start: number; end?: number }
}

export type ToolCallUpdateData = {
  toolCallId: string
  kind?: string | null
  status?: string | null
  title?: string | null
  detail?: string | null
  preview?: string | null
  diffs?: ToolDiffData[] | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'thought' | 'tool'
  text: string
  /** @deprecated 用 toolCall.title；兼容磁盘投影 */
  tool?: string
  toolCallId?: string
  /** 完整工具快照（实时事件） */
  toolCall?: ToolCallData
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
