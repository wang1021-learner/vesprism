export type SessionStatus = 'initializing' | 'idle' | 'generating' | 'ended' | 'unknown'

export type PermissionOption = {
  id: string
  name: string
}

export type PermissionRequest = {
  request_id: number
  description: string
  options: PermissionOption[]
}

/** 工具调用卡片数据（与后端 ToolCallInfo camelCase 对齐） */
export type ToolCallData = {
  toolCallId: string
  kind: string
  status: string
  title: string
  detail: string
  preview: string
}

export type ToolCallUpdateData = {
  toolCallId: string
  kind?: string | null
  status?: string | null
  title?: string | null
  detail?: string | null
  preview?: string | null
}

export type SessionEvent =
  | { type: 'agent_text_chunk'; text: string }
  | { type: 'agent_thought_chunk'; text: string }
  | { type: 'user_text_chunk'; text: string; prompt_id?: string }
  | { type: 'turn_ended'; stop_reason: string; prompt_id?: string }
  | { type: 'error'; message: string; prompt_id?: string }
  | { type: 'other'; debug: string }
  | { type: 'tool_call'; tool: ToolCallData }
  | { type: 'tool_call_update'; update: ToolCallUpdateData }
  | { type: 'token_usage'; total_tokens: number }
  | {
      type: 'permission_request'
      request_id: number
      description: string
      options: PermissionOption[]
    }
  | { type: 'status_changed'; status: SessionStatus }
  | { type: 'session_id_changed'; session_id: string }

export type ChatRole = 'user' | 'assistant' | 'thought' | 'system' | 'tool'

export type ChatMessage = {
  id: number
  role: ChatRole
  text: string
  /** role === 'tool' 时的卡片数据 */
  tool?: ToolCallData
  promptId?: string
}

/** 官方 api_backend 三选一 */
export type ApiBackend = 'chat_completions' | 'responses' | 'messages'

export type ModelEntry = {
  id: string
  /** 始终与 model 相同（展示名 = API 模型 id） */
  name: string
  /** 模型名称（即发往 API 的 model id） */
  model: string
  base_url: string
  env_key: string
  context_window: number
  system_prompt_label: string
  api_backend: ApiBackend | string
  description: string
  temperature: number
  top_p: number
  max_completion_tokens: number
  extra_headers: Record<string, string>
  api_base_url: string
  max_retries: number
  inference_idle_timeout_secs: number
  /** null = 不写盘 */
  stream_tool_calls: boolean | null
  agent_type: string
  use_concise: boolean
  /** 0 = 不写盘 */
  auto_compact_threshold_percent: number
  /** 此模型是否支持推理强度 */
  supports_reasoning_effort: boolean
  /** none|minimal|low|medium|high|xhigh */
  reasoning_effort: string
  hidden: boolean
  supported_in_api: boolean
  laziness_enabled: boolean
  laziness_max_nudges: number
  /** "" | dynamic | off | 数字 */
  compactions_remaining: string
  compaction_at_tokens: string
}

export function emptyModelEntry(partial: Partial<ModelEntry> & { id: string }): ModelEntry {
  const model = partial.model ?? ''
  return {
    id: partial.id,
    name: partial.name ?? model,
    model,
    base_url: partial.base_url ?? '',
    env_key: partial.env_key ?? '',
    context_window: partial.context_window ?? 0,
    system_prompt_label: partial.system_prompt_label ?? '',
    api_backend: partial.api_backend ?? 'chat_completions',
    description: partial.description ?? '',
    temperature: partial.temperature ?? 0,
    top_p: partial.top_p ?? 0,
    max_completion_tokens: partial.max_completion_tokens ?? 0,
    extra_headers: partial.extra_headers ?? {},
    api_base_url: partial.api_base_url ?? '',
    max_retries: partial.max_retries ?? 0,
    inference_idle_timeout_secs: partial.inference_idle_timeout_secs ?? 0,
    stream_tool_calls:
      partial.stream_tool_calls === undefined ? null : partial.stream_tool_calls,
    agent_type: partial.agent_type ?? 'grok-build',
    use_concise: partial.use_concise ?? false,
    auto_compact_threshold_percent: partial.auto_compact_threshold_percent ?? 0,
    supports_reasoning_effort: partial.supports_reasoning_effort ?? false,
    reasoning_effort: partial.reasoning_effort ?? 'medium',
    hidden: partial.hidden ?? false,
    supported_in_api: partial.supported_in_api ?? true,
    laziness_enabled: partial.laziness_enabled ?? false,
    laziness_max_nudges: partial.laziness_max_nudges ?? 0,
    compactions_remaining: partial.compactions_remaining ?? '',
    compaction_at_tokens: partial.compaction_at_tokens ?? '',
  }
}

/** Claude / Codex 风格推理档位 */
export const REASONING_LEVELS = [
  { value: 'none', label: '关闭' },
  { value: 'minimal', label: '最低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '最强' },
] as const


export type ModelSettings = {
  default_id: string
  models: ModelEntry[]
  config_path: string
}

export type RecentChat = {
  id: string
  title: string
  timestamp: string
  rawTimestamp?: string
  /** 会话所属工作空间绝对路径；用于侧栏分组与 load/delete/rename */
  cwd?: string
}
