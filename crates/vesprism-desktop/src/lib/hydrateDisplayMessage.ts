import type { ChatMessage, ToolCallData } from '../types'

/** 磁盘投影行（get_session_messages / updates.jsonl） */
export type DisplayMessage = {
  id: string
  role: string
  text: string
  tool?: string | null
  tool_call_id?: string | null
  prompt_id?: string | null
  kind?: string | null
  status?: string | null
  detail?: string | null
  preview?: string | null
  start_ms?: number | null
  end_ms?: number | null
}

/** 磁盘投影 → ChatMessage（工具字段与实时 ToolCallInfo 对齐，不再靠标题猜 kind） */
export function hydrateDisplayMessage(m: DisplayMessage): ChatMessage {
  const role = (
    ['user', 'assistant', 'system', 'thought', 'tool'].includes(m.role)
      ? m.role
      : 'assistant'
  ) as ChatMessage['role']

  if (role === 'tool') {
    const title = m.tool || 'tool'
    const preview = m.preview || m.text || ''
    const detail = m.detail || title
    const toolCall: ToolCallData = {
      toolCallId: m.tool_call_id || m.id,
      kind: (m.kind || 'other').toLowerCase(),
      status: (m.status || 'completed').toLowerCase(),
      title,
      detail,
      preview,
      // 历史耗时：磁盘 updates.jsonl 的 timestamp 解析（毫秒）
      timing:
        m.start_ms != null
          ? { start: m.start_ms, ...(m.end_ms != null ? { end: m.end_ms } : {}) }
          : undefined,
    }
    return {
      id: m.id,
      role: 'tool',
      text: preview || detail,
      tool: title,
      toolCallId: toolCall.toolCallId,
      toolCall,
    }
  }

  return {
    id: m.id,
    role,
    text: m.text || '',
    ...(m.tool ? { tool: m.tool } : {}),
    ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
    ...(m.prompt_id ? { promptId: m.prompt_id } : {}),
  }
}
