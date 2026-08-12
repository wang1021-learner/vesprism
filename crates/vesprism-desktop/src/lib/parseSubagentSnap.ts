/**
 * 解析 get_subagent 响应（字段名可能 snake / camel / 嵌套 data）
 */
import type { SubagentRuntime } from '../types'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asStr(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return undefined
}

const STATUS: SubagentRuntime['status'][] = [
  'running',
  'completed',
  'failed',
  'cancelled',
]

function asStatus(
  v: unknown,
  fallback: SubagentRuntime['status'],
): SubagentRuntime['status'] {
  const s = asStr(v)?.toLowerCase()
  if (!s) return fallback
  if ((STATUS as string[]).includes(s)) {
    return s as SubagentRuntime['status']
  }
  // 常见别名
  if (s === 'success' || s === 'done' || s === 'ok') return 'completed'
  if (s === 'error' || s === 'failure') return 'failed'
  if (s === 'canceled' || s === 'abort' || s === 'aborted') return 'cancelled'
  if (s === 'in_progress' || s === 'active' || s === 'pending') return 'running'
  return fallback
}

/**
 * 从 get_subagent 原始 JSON 抽出可合并进 SubagentRuntime 的补丁。
 */
export function parseSubagentSnap(
  snap: unknown,
  fallback: SubagentRuntime,
): Partial<SubagentRuntime> & { subagentId: string } {
  const root = asRecord(snap)
  if (!root) {
    return { subagentId: fallback.subagentId }
  }
  const nested = asRecord(root.data) || asRecord(root.result) || asRecord(root.subagent)
  const o = nested ? { ...root, ...nested } : root

  const turnCount =
    asNum(pick(o, 'turn_count', 'turnCount', 'turns')) ?? fallback.turnCount
  const toolCallCount =
    asNum(pick(o, 'tool_call_count', 'toolCallCount', 'tool_calls', 'toolCalls')) ??
    fallback.toolCallCount
  const tokensUsed =
    asNum(pick(o, 'tokens_used', 'tokensUsed', 'tokens')) ?? fallback.tokensUsed
  const durationMs =
    asNum(pick(o, 'duration_ms', 'durationMs', 'duration')) ?? fallback.durationMs
  const contextUsagePct =
    asNum(pick(o, 'context_usage_pct', 'contextUsagePct')) ??
    fallback.contextUsagePct
  const errorCount =
    asNum(pick(o, 'error_count', 'errorCount')) ?? fallback.errorCount

  const toolsRaw = pick(o, 'tools_used', 'toolsUsed', 'tools')
  const toolsUsed = Array.isArray(toolsRaw)
    ? toolsRaw.map((t) => String(t))
    : fallback.toolsUsed

  return {
    subagentId: fallback.subagentId,
    status: asStatus(pick(o, 'status', 'state'), fallback.status),
    turnCount,
    toolCallCount,
    tokensUsed,
    durationMs,
    contextUsagePct,
    toolsUsed,
    errorCount,
    output: asStr(pick(o, 'output', 'result_text', 'resultText')) ?? fallback.output,
    error: asStr(pick(o, 'error', 'error_message', 'errorMessage')) ?? fallback.error,
    model: asStr(pick(o, 'model', 'model_id', 'modelId')) ?? fallback.model,
    childSessionId:
      asStr(pick(o, 'child_session_id', 'childSessionId', 'session_id', 'sessionId')) ||
      fallback.childSessionId,
    description:
      asStr(pick(o, 'description', 'desc', 'title')) || fallback.description,
    subagentType:
      asStr(pick(o, 'subagent_type', 'subagentType', 'type', 'agent_type')) ||
      fallback.subagentType,
  }
}
