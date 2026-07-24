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
  | { type: 'user_text_chunk'; text: string }
  | { type: 'turn_ended'; stop_reason: string }
  | { type: 'error'; message: string }
  | { type: 'other'; debug: string }
  | { type: 'tool_call'; tool: ToolCallData }
  | { type: 'tool_call_update'; update: ToolCallUpdateData }
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
}

export type ModelEntry = {
  id: string
  name: string
  model: string
  base_url: string
  env_key: string
  context_window: number
  system_prompt_label: string
}


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
}
