/**
 * 子 Agent → 对话内 scaffold 行（与 tool/thought 同形态）
 * toolCallId = subagent_${subagentId}
 * detail = childSessionId（用于开 Tab）
 */
import type { ChatMessage, SubagentRuntime, ToolCallData } from '../types'
import { generateId } from './generateId'

export const SUBAGENT_TOOL_PREFIX = 'subagent_'

export function subagentToolCallId(subagentId: string): string {
  return `${SUBAGENT_TOOL_PREFIX}${subagentId}`
}

export function parseSubagentIdFromToolCallId(toolCallId: string): string | null {
  if (!toolCallId.startsWith(SUBAGENT_TOOL_PREFIX)) return null
  return toolCallId.slice(SUBAGENT_TOOL_PREFIX.length) || null
}

function statusUi(s: SubagentRuntime['status']): {
  toolStatus: string
  label: string
} {
  switch (s) {
    case 'running':
      return { toolStatus: 'in_progress', label: '运行中' }
    case 'completed':
      return { toolStatus: 'completed', label: '完成' }
    case 'failed':
      return { toolStatus: 'failed', label: '失败' }
    case 'cancelled':
      return { toolStatus: 'failed', label: '已取消' }
    default:
      return { toolStatus: 'in_progress', label: String(s) }
  }
}

function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return r ? `${m}m${r}s` : `${m}m`
}

/** 会话列表展示标题：子任务 · 描述 · 状态 · 轮次/耗时 */
export function formatSubagentHeadline(s: SubagentRuntime): string {
  const name =
    (s.description || '').trim() ||
    (s.subagentType || '').trim() ||
    '子任务'
  const { label } = statusUi(s.status)
  const bits = [label]
  if (typeof s.turnCount === 'number' && s.turnCount > 0) {
    bits.push(`${s.turnCount} 轮`)
  }
  if (s.durationMs) bits.push(formatDuration(s.durationMs))
  return `子任务 · ${name} · ${bits.join(' · ')}`
}

export function subagentToToolData(s: SubagentRuntime): ToolCallData {
  const { toolStatus } = statusUi(s.status)
  const now = Date.now()
  const start =
    s.durationMs != null && s.durationMs >= 0 ? now - s.durationMs : now
  const end =
    s.status === 'running' ? undefined : now
  const preview = (s.output || s.error || '').trim()
  return {
    toolCallId: subagentToolCallId(s.subagentId),
    kind: 'subagent',
    status: toolStatus,
    title: formatSubagentHeadline(s),
    // detail 存 childSessionId，点击开 Tab 用
    detail: (s.childSessionId || '').trim(),
    preview,
    timing: { start, ...(end != null ? { end } : {}) },
  }
}

/** 在消息列表中插入或更新子任务 scaffold 行 */
export function upsertSubagentMessage(
  messages: ChatMessage[],
  s: SubagentRuntime,
): ChatMessage[] {
  const tool = subagentToToolData(s)
  const idx = messages.findIndex(
    (m) => m.role === 'tool' && m.toolCallId === tool.toolCallId,
  )
  const next: ChatMessage = {
    id: idx >= 0 ? messages[idx].id : generateId('msg_'),
    role: 'tool',
    text: tool.preview || tool.title,
    tool: tool.title,
    toolCallId: tool.toolCallId,
    toolCall: tool,
    isStreaming: tool.status === 'in_progress' || tool.status === 'pending',
  }
  if (idx >= 0) {
    const copy = messages.slice()
    const prev = messages[idx].toolCall
    const endNow = Date.now()
    const merged: ToolCallData = {
      ...tool,
      // 保留已有 preview（若新 patch 没有 output）
      preview: tool.preview || prev?.preview || '',
      timing: prev?.timing?.start
        ? {
            start: prev.timing.start,
            end:
              tool.status === 'in_progress'
                ? undefined
                : (tool.timing?.end ?? endNow),
          }
        : tool.timing,
    }
    copy[idx] = {
      ...next,
      toolCall: merged,
      text: merged.preview || merged.title,
      isStreaming:
        merged.status === 'in_progress' || merged.status === 'pending',
    }
    return copy
  }
  return [...messages, next]
}
