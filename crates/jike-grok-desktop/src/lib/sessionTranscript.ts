/**
 * 会话 transcript 事件 → 消息列表。
 * 实时与历史回放共用同一套合并规则。
 */
import type {
  ChatMessage,
  ToolCallData,
  ToolCallUpdateData,
  ToolDiffData,
} from '../types'
import { generateId } from './generateId'

/** 与后端 FrontendEvent / ToolCallInfo 对齐 */
export type TranscriptEvent = {
  type: string
  text?: string
  prompt_id?: string | null
  message?: string
  tool?: Omit<Partial<ToolCallData>, 'diffs'> & {
    tool_call_id?: string
    call_id?: string
    name?: string
    input?: Record<string, unknown>
    oldText?: string | null
    newText?: string
    diffs?: unknown[]
  }
  update?: Omit<Partial<ToolCallUpdateData>, 'diffs'> & {
    tool_call_id?: string
    call_id?: string
    output?: string
    diffs?: unknown[] | null
  }
  total_tokens?: number
  request_id?: number
  description?: string
  options?: { id: string; name: string; kind?: string }[]
  status?: string
  session_id?: string
  stop_reason?: string
}

function toolId(t: {
  toolCallId?: string
  tool_call_id?: string
  call_id?: string
}): string {
  return t.toolCallId || t.tool_call_id || t.call_id || generateId('tool_')
}

function normalizeDiffs(raw: unknown): ToolDiffData[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((d) => {
    const x = d as Record<string, unknown>
    return {
      path: String(x.path ?? ''),
      oldText: (x.oldText ?? x.old_text ?? null) as string | null,
      newText: String(x.newText ?? x.new_text ?? ''),
    }
  })
}

function toToolData(t: NonNullable<TranscriptEvent['tool']>): ToolCallData {
  const now = Date.now()
  const kind = t.kind || 'other'
  const title = t.title || t.name || kind || 'tool'
  const detail =
    t.detail?.trim() ||
    (t.input ? JSON.stringify(t.input) : '') ||
    title
  const preview = t.preview?.trim() || ''
  return {
    toolCallId: toolId(t),
    kind,
    status: t.status || 'pending',
    title,
    detail,
    preview,
    diffs: normalizeDiffs(t.diffs),
    timing: { start: now },
  }
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
      const base = sealStreamingTail(messages)
      const last = base[base.length - 1]
      if (last?.role === 'user') {
        if (pid != null && last.promptId === pid) {
          return [...base.slice(0, -1), { ...last, text: last.text + text }]
        }
        if (pid == null && last.promptId == null) {
          return [...base.slice(0, -1), { ...last, text: last.text + text }]
        }
      }
      return [
        ...base,
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
      return upsertTool(sealStreamingTail(messages), toToolData(ev.tool))
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
      {
        ...last,
        text: last.text + text,
        isStreaming: true,
        ...(role === 'thought' && last.thoughtTiming
          ? { thoughtTiming: { ...last.thoughtTiming, end: undefined } }
          : role === 'thought'
            ? { thoughtTiming: { start: Date.now() } }
            : {}),
      },
    ]
  }
  const sealed = sealStreamingTail(messages)
  const now = Date.now()
  return [
    ...sealed,
    {
      id: generateId('msg_'),
      role,
      text,
      isStreaming: true,
      ...(role === 'thought' ? { thoughtTiming: { start: now } } : {}),
    },
  ]
}

/** 结束当前流式尾条（turn_ended / 换角色时） */
export function sealStreamingMessages(messages: ChatMessage[]): ChatMessage[] {
  return sealStreamingTail(messages)
}

function sealStreamingTail(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages
  let changed = false
  const now = Date.now()
  const next = messages.map((m) => {
    // 工具：结束计时 + 未完成状态收成 completed（turn 结束时）
    if (m.role === 'tool' && m.toolCall) {
      const tc = m.toolCall
      const open =
        m.isStreaming ||
        tc.status === 'pending' ||
        tc.status === 'in_progress' ||
        (tc.timing && !tc.timing.end)
      if (open) {
        changed = true
        const status =
          tc.status === 'failed'
            ? 'failed'
            : tc.status === 'completed'
              ? 'completed'
              : 'completed'
        return {
          ...m,
          isStreaming: false,
          toolCall: {
            ...tc,
            status,
            timing: tc.timing
              ? { start: tc.timing.start, end: tc.timing.end ?? now }
              : { start: now, end: now },
          },
        }
      }
    }
    if (!m.isStreaming) return m
    changed = true
    if (m.role === 'thought' && m.thoughtTiming?.start) {
      return {
        ...m,
        isStreaming: false,
        thoughtTiming: { start: m.thoughtTiming.start, end: now },
      }
    }
    return { ...m, isStreaming: false }
  })
  return changed ? next : messages
}

function upsertTool(messages: ChatMessage[], tool: ToolCallData): ChatMessage[] {
  const idx = messages.findIndex(
    (m) => m.role === 'tool' && m.toolCallId === tool.toolCallId,
  )
  const next: ChatMessage = {
    id: idx >= 0 ? messages[idx].id : generateId('msg_'),
    role: 'tool',
    text: tool.preview || tool.detail || tool.title,
    tool: tool.title,
    toolCallId: tool.toolCallId,
    toolCall: tool,
    isStreaming:
      tool.status === 'pending' || tool.status === 'in_progress',
  }
  if (idx >= 0) {
    const prev = messages[idx]
    const merged: ToolCallData = {
      ...prev.toolCall,
      ...tool,
      timing: prev.toolCall?.timing ?? tool.timing,
      diffs: tool.diffs?.length ? tool.diffs : prev.toolCall?.diffs,
      preview: tool.preview || prev.toolCall?.preview || '',
      detail: tool.detail || prev.toolCall?.detail || '',
      title: tool.title || prev.toolCall?.title || 'tool',
    }
    const copy = messages.slice()
    copy[idx] = {
      ...next,
      id: prev.id,
      toolCall: merged,
      text: merged.preview || merged.detail || merged.title,
      tool: merged.title,
    }
    return copy
  }
  return [...messages, next]
}

function patchTool(
  messages: ChatMessage[],
  update: NonNullable<TranscriptEvent['update']>,
): ChatMessage[] {
  const id = toolId(update)
  const idx = messages.findIndex(
    (m) => m.role === 'tool' && m.toolCallId === id,
  )
  if (idx < 0) {
    return upsertTool(messages, {
      toolCallId: id,
      kind: update.kind ?? 'other',
      status: update.status ?? 'in_progress',
      title: update.title ?? 'tool',
      detail: update.detail ?? '',
      preview: update.preview ?? update.output ?? '',
      diffs: normalizeDiffs(update.diffs),
      timing: { start: Date.now() },
    })
  }
  const cur = messages[idx]
  const prev = cur.toolCall
  const status = update.status ?? prev?.status ?? 'in_progress'
  const now = Date.now()
  const timing = prev?.timing
    ? status === 'completed' || status === 'failed'
      ? { start: prev.timing.start, end: prev.timing.end ?? now }
      : prev.timing
    : { start: now }

  const merged: ToolCallData = {
    toolCallId: id,
    kind: update.kind ?? prev?.kind ?? 'other',
    status,
    title: update.title?.trim() || prev?.title || 'tool',
    detail: update.detail?.trim() || prev?.detail || '',
    preview:
      (update.preview ?? update.output)?.trim() || prev?.preview || '',
    diffs: normalizeDiffs(update.diffs) ?? prev?.diffs,
    timing,
  }

  const copy = messages.slice()
  copy[idx] = {
    ...cur,
    text: merged.preview || merged.detail || merged.title,
    tool: merged.title,
    toolCallId: id,
    toolCall: merged,
    isStreaming: status === 'pending' || status === 'in_progress',
  }
  return copy
}
