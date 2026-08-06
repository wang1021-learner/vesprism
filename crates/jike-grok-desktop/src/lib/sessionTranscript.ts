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
  /** AI 问卷 */
  tool_call_id?: string
  mode?: string
  questions?: Array<{
    question: string
    options: Array<{ label: string; description?: string; preview?: string | null }>
    multiSelect?: boolean | null
  }>
  /** 问卷已解答时的摘要 */
  answer_preview?: string
  outcome?: string
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

/** 归一化工具状态（后端偶发 success / done / running 等） */
function normalizeToolStatus(raw?: string | null): string {
  const s = (raw || '').trim().toLowerCase()
  if (!s) return 'pending'
  if (s === 'success' || s === 'done' || s === 'ok' || s === 'complete') {
    return 'completed'
  }
  if (s === 'running' || s === 'started' || s === 'start') return 'in_progress'
  if (s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  return s
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
    status: normalizeToolStatus(t.status),
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
      // 引擎自动注入的 workflow 完成唤醒 prompt（origin=WorkflowCompleted）：
      // 只用于驱动主 agent 汇报结果，不展示为用户气泡
      if (pid && pid.startsWith('workflow-completed-')) return messages
      const base = sealStreamingTail(messages)
      return mergeUserTextChunk(base, text, pid)
    }
    case 'tool_call': {
      if (!ev.tool) return messages
      return upsertTool(sealStreamingTail(messages), toToolData(ev.tool))
    }
    case 'tool_call_update': {
      if (!ev.update) return messages
      return patchTool(messages, ev.update)
    }
    case 'user_question_request': {
      const toolCallId = ev.tool_call_id || `ask_${ev.request_id ?? generateId('ask_')}`
      const detail = formatAskUserDetail(ev.questions)
      return upsertTool(sealStreamingTail(messages), {
        toolCallId,
        kind: 'ask_user',
        status: 'pending',
        title: 'Ask',
        detail,
        preview: '',
        timing: { start: Date.now() },
      })
    }
    case 'user_question_resolved': {
      const toolCallId = ev.tool_call_id
      if (!toolCallId) return messages
      const preview = ev.answer_preview || formatAskUserAnswerPreview(ev.outcome)
      // 保留原题目 detail；preview 写答案摘要；取消也用 completed（工具卡终态）
      return patchTool(messages, {
        toolCallId,
        kind: 'ask_user',
        status: 'completed',
        title: 'Ask',
        preview,
      })
    }
    default:
      return messages
  }
}

/** 问卷工具卡详情：首题 + 题数 */
export function formatAskUserDetail(
  questions?: Array<{ question: string }>,
): string {
  if (!questions?.length) return '向你提问'
  const first = questions[0].question.trim() || '向你提问'
  if (questions.length === 1) return first
  return `${first}（共 ${questions.length} 题）`
}

/**
 * 问卷解答后的预览文案。
 * accepted 且传入 answers 时拼选项，便于会话回顾。
 */
export function formatAskUserAnswerPreview(
  outcome?: string,
  answers?: Record<string, string[]>,
): string {
  if (outcome === 'accepted' && answers && Object.keys(answers).length > 0) {
    return formatAcceptedAnswersPreview(answers)
  }
  switch (outcome) {
    case 'accepted':
      return '已回答'
    case 'chat_about_this':
      return '改为讨论'
    case 'skip_interview':
      return '跳过问卷'
    case 'cancelled':
      return '已取消'
    default:
      return outcome ? `已处理 · ${outcome}` : '已处理'
  }
}

/** 把 answers 压成一行回顾文案：`题 → 选项` */
export function formatAcceptedAnswersPreview(
  answers: Record<string, string[]>,
  maxItems: number = 3,
  maxQ: number = 28,
): string {
  const entries = Object.entries(answers).filter(
    ([, opts]) => opts && opts.length > 0,
  )
  if (entries.length === 0) return '已回答'
  const lines = entries.map(([q, opts]) => {
    const shortQ =
      q.length > maxQ ? `${q.slice(0, maxQ - 1).trimEnd()}…` : q
    return `${shortQ} → ${opts.join('、')}`
  })
  if (lines.length <= maxItems) return lines.join('；')
  return `${lines.slice(0, maxItems).join('；')}…`
}

/**
 * 合并用户文本回显，兼容乐观 UI：
 * - 发送时前端已插入带 promptId 的完整气泡
 * - 引擎稍后推 user_text_chunk（可能分片 / 丢 meta），不得再插第二条
 */
function mergeUserTextChunk(
  messages: ChatMessage[],
  text: string,
  pid: string | undefined,
): ChatMessage[] {
  // 1) 按 promptId 精确核销（乐观气泡 / 流式回显）
  if (pid != null) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'user' || m.promptId !== pid) continue

      if (!m.text) {
        const copy = messages.slice()
        copy[i] = { ...m, text }
        return copy
      }
      // 乐观全文已覆盖该分片（前缀 / 子串 / 全文）
      if (m.text === text || m.text.startsWith(text) || m.text.includes(text)) {
        return messages
      }
      // 累积式回显：服务端每次推更长前缀
      if (text.startsWith(m.text)) {
        const copy = messages.slice()
        copy[i] = { ...m, text }
        return copy
      }
      // 增量分片（无乐观时）：拼到尾部
      const copy = messages.slice()
      copy[i] = { ...m, text: m.text + text }
      return copy
    }
  }

  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    // 2) 双方都无 promptId：按流式尾部拼接
    if (pid == null && last.promptId == null) {
      return [...messages.slice(0, -1), { ...last, text: last.text + text }]
    }
    // 3) 尾部是乐观气泡（有 promptId），回显丢了 meta：按内容核销，避免重复
    if (pid == null && last.promptId != null && last.text) {
      if (
        last.text === text ||
        last.text.startsWith(text) ||
        last.text.includes(text)
      ) {
        return messages
      }
      if (text.startsWith(last.text)) {
        return [...messages.slice(0, -1), { ...last, text }]
      }
      // 刚发送的尾部用户气泡优先，不再插第二条
      return messages
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

/** 发送失败时撤掉对应乐观用户气泡 */
export function removeUserMessageByPromptId(
  messages: ChatMessage[],
  promptId: string,
): ChatMessage[] {
  const next = messages.filter(
    (m) => !(m.role === 'user' && m.promptId === promptId),
  )
  return next.length === messages.length ? messages : next
}

/**
 * 引擎常把 reasoning 与正文交错下发，导致「Thinking briefly」夹在每句答案中间。
 * 空/极短思考视为噪声：丢弃后让 assistant 分片重新合并成一条气泡。
 */
function isNoiseThought(m: ChatMessage): boolean {
  if (m.role !== 'thought') return false
  const t = (m.text || '').trim()
  if (!t) return true
  // 仍在流式的思考先保留，避免把正在写的 reasoning 吃掉
  if (m.isStreaming) return false
  const ms =
    m.thoughtTiming?.start && m.thoughtTiming?.end
      ? m.thoughtTiming.end - m.thoughtTiming.start
      : 0
  // 极短 + 短文案：交错噪声
  if (ms > 0 && ms < 800 && t.length < 120) return true
  if (ms === 0 && t.length < 40) return true
  return false
}

function dropTrailingNoiseThoughts(messages: ChatMessage[]): ChatMessage[] {
  let end = messages.length
  while (end > 0 && isNoiseThought(messages[end - 1])) end--
  return end === messages.length ? messages : messages.slice(0, end)
}

/** 合并相邻同角色 assistant/thought（去噪后正文可拼回一条） */
function mergeAdjacentTextRoles(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) return messages
  const out: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'thought' && isNoiseThought(m)) continue
    const last = out[out.length - 1]
    if (
      last &&
      (m.role === 'assistant' || m.role === 'thought') &&
      last.role === m.role
    ) {
      const timing =
        m.role === 'thought'
          ? {
              start:
                last.thoughtTiming?.start ??
                m.thoughtTiming?.start ??
                Date.now(),
              end: m.thoughtTiming?.end ?? last.thoughtTiming?.end,
            }
          : undefined
      out[out.length - 1] = {
        ...last,
        text: (last.text || '') + (m.text || ''),
        isStreaming: Boolean(last.isStreaming || m.isStreaming),
        ...(timing ? { thoughtTiming: timing } : {}),
      }
    } else {
      out.push(m)
    }
  }
  return out
}

function appendRole(
  messages: ChatMessage[],
  role: 'assistant' | 'thought',
  text: string,
): ChatMessage[] {
  // 纯空白思考不建行
  if (role === 'thought' && !text.trim()) return messages

  // 写正文前丢掉尾部噪声思考，才能并回上一条 assistant
  let base =
    role === 'assistant' ? dropTrailingNoiseThoughts(messages) : messages

  const last = base[base.length - 1]
  if (last && last.role === role) {
    return [
      ...base.slice(0, -1),
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
  const sealed = sealStreamingTail(base)
  // seal 后再清一次尾部噪声思考
  base = role === 'assistant' ? dropTrailingNoiseThoughts(sealed) : sealed
  const last2 = base[base.length - 1]
  if (last2 && last2.role === role) {
    return [
      ...base.slice(0, -1),
      {
        ...last2,
        text: last2.text + text,
        isStreaming: true,
        ...(role === 'thought' && last2.thoughtTiming
          ? { thoughtTiming: { ...last2.thoughtTiming, end: undefined } }
          : role === 'thought'
            ? { thoughtTiming: { start: Date.now() } }
            : {}),
      },
    ]
  }
  const now = Date.now()
  return [
    ...base,
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
export function sealStreamingMessages(
  messages: ChatMessage[],
  turnPromptId?: string | null,
): ChatMessage[] {
  // 回合归属：turn_ended 的 prompt_id 若与「最后一条 user 气泡」不一致，
  // 说明是旧回合（被中断）的迟到收尾——只 seal user 之前的内容，
  // 不碰 user 之后新回合正在流式的行（否则回复会被切成两半）。
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx >= 0) {
    const lastUserPid = messages[lastUserIdx].promptId
    if (turnPromptId && lastUserPid && turnPromptId !== lastUserPid) {
      const head = sealStreamingTail(messages.slice(0, lastUserIdx))
      return mergeAdjacentTextRoles(
        dropTrailingNoiseThoughts([...head, ...messages.slice(lastUserIdx)]),
      )
    }
  }
  return mergeAdjacentTextRoles(dropTrailingNoiseThoughts(sealStreamingTail(messages)))
}

function sealStreamingTail(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages
  let changed = false
  const now = Date.now()
  const next = messages.map((m) => {
    // 工具：结束计时 + 未完成状态收成 completed（turn 结束时）
    // 子 agent 独立生命周期：只听 subagent_finished，勿被父 turn_ended 误定稿
    if (m.role === 'tool' && m.toolCall) {
      const tc = m.toolCall
      if ((tc.kind || '').toLowerCase() === 'subagent') return m
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
  // 更新事件常不带 status：保留原状态，勿把 completed 打回 pending
  const status = normalizeToolStatus(
    update.status != null && String(update.status).trim() !== ''
      ? update.status
      : (prev?.status ?? 'in_progress'),
  )
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
