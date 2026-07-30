/**
 * 会话 transcript 事件 → 消息列表。
 * 实时与历史回放共用同一套合并规则。
 */
import type { ChatMessage } from '../types'
import { generateId } from './generateId'

/** 与后端 FrontendEvent / ToolCallInfo 对齐 */
export type TranscriptEvent = {
  type: string
  text?: string
  prompt_id?: string | null
  message?: string
  tool?: ToolPayload
  update?: ToolUpdatePayload
  total_tokens?: number
  request_id?: number
  description?: string
  options?: { id: string; name: string; kind?: string }[]
  status?: string
  session_id?: string
  stop_reason?: string
}

export type ToolPayload = {
  toolCallId?: string
  tool_call_id?: string
  kind?: string
  status?: string
  title?: string
  detail?: string
  preview?: string
  name?: string
  call_id?: string
  input?: Record<string, unknown>
  diffs?: unknown[]
}

export type ToolUpdatePayload = {
  toolCallId?: string
  tool_call_id?: string
  kind?: string | null
  status?: string | null
  title?: string | null
  detail?: string | null
  preview?: string | null
  call_id?: string
  output?: string
  diffs?: unknown[] | null
}

function toolId(t: {
  toolCallId?: string
  tool_call_id?: string
  call_id?: string
}): string {
  return t.toolCallId || t.tool_call_id || t.call_id || generateId('tool_')
}

function toolText(t: ToolPayload): string {
  if (t.preview?.trim()) return t.preview
  if (t.detail?.trim()) return t.detail
  if (t.title?.trim()) return t.title
  if (t.input) return JSON.stringify(t.input, null, 2)
  return t.name || '工具调用'
}

function toolLabel(t: ToolPayload): string {
  return t.title || t.detail || t.kind || t.name || 'tool'
}

/** 把一条 session-event 应用到消息列表（不可变） */
export function applyTranscriptEvent(
  messages: ChatMessage[],
  ev: TranscriptEvent,
): ChatMessage[] {
  switch (ev.type) {
    case 'agent_text_chunk': {
      const text = ev.text || ''
      if (!text) return messages
      return appendRole(messages, 'assistant', text)
    }
    case 'agent_thought_chunk': {
      const text = ev.text || ''
      if (!text) return messages
      return appendRole(messages, 'thought', text)
    }
    case 'user_text_chunk': {
      const text = ev.text || ''
      if (!text) return messages
      const pid = ev.prompt_id ?? undefined
      const last = messages[messages.length - 1]
      if (last?.role === 'user') {
        // 同一 prompt 的后续分片
        if (pid != null && last.promptId === pid) {
          return [
            ...messages.slice(0, -1),
            { ...last, text: last.text + text },
          ]
        }
        // 双方都无 promptId：兼容旧事件/流式分片
        if (pid == null && last.promptId == null) {
          return [
            ...messages.slice(0, -1),
            { ...last, text: last.text + text },
          ]
        }
      }
      return [
        ...messages,
        {
          id: generateId('msg_'),
          role: 'user',
          text,
          ...(pid != null ? { promptId: pid } : {}),
        },
      ]
    }
    case 'tool_call': {
      if (!ev.tool) return messages
      return upsertTool(messages, ev.tool)
    }
    case 'tool_call_update': {
      if (!ev.update) return messages
      return patchTool(messages, ev.update)
    }
    default:
      return messages
  }
}

function appendRole(
  messages: ChatMessage[],
  role: 'assistant' | 'thought',
  text: string,
): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === role) {
    return [
      ...messages.slice(0, -1),
      { ...last, text: last.text + text },
    ]
  }
  return [...messages, { id: generateId('msg_'), role, text }]
}

function upsertTool(messages: ChatMessage[], tool: ToolPayload): ChatMessage[] {
  const id = toolId(tool)
  const idx = messages.findIndex(
    (m) => m.role === 'tool' && m.toolCallId === id,
  )
  const next: ChatMessage = {
    id: idx >= 0 ? messages[idx].id : generateId('msg_'),
    role: 'tool',
    text: toolText(tool),
    tool: toolLabel(tool),
    toolCallId: id,
  }
  if (idx >= 0) {
    const copy = messages.slice()
    copy[idx] = next
    return copy
  }
  return [...messages, next]
}

function patchTool(
  messages: ChatMessage[],
  update: ToolUpdatePayload,
): ChatMessage[] {
  const id = toolId(update)
  const idx = messages.findIndex(
    (m) => m.role === 'tool' && m.toolCallId === id,
  )
  if (idx < 0) {
    return upsertTool(messages, {
      toolCallId: id,
      title: update.title ?? undefined,
      detail: update.detail ?? undefined,
      preview: update.preview ?? update.output ?? undefined,
      kind: update.kind ?? undefined,
      status: update.status ?? undefined,
    })
  }
  const cur = messages[idx]
  const text =
    (update.preview ?? update.output ?? update.detail)?.trim() || cur.text
  const label = update.title?.trim() || cur.tool
  const copy = messages.slice()
  copy[idx] = {
    ...cur,
    text,
    tool: label,
    toolCallId: id,
  }
  return copy
}
