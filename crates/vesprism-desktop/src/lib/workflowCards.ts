/** 仍占会话区完整进度卡的状态（含暂停，用户可能还要看）。 */
export const WORKFLOW_LIVE = new Set([
  'running',
  'active',
  'in_progress',
  'executing',
  'planning',
  'paused',
])

export const RESULT_HEADLINE_MAX = 160
export const RESULT_EXPAND_MAX = 4000

export function isWorkflowLive(status: string): boolean {
  return WORKFLOW_LIVE.has(status.trim().toLowerCase())
}

export function workflowAgentUiStatus(
  state: string,
): 'running' | 'completed' | 'failed' | 'cancelled' {
  switch (state.trim().toLowerCase()) {
    case 'running':
    case 'active':
      return 'running'
    case 'failed':
    case 'error':
      return 'failed'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return 'completed'
  }
}

export function workflowAgentStateLabel(state: string): string {
  switch (state.trim().toLowerCase()) {
    case 'running':
    case 'active':
      return '运行中'
    case 'complete':
    case 'completed':
    case 'done':
      return '完成'
    case 'failed':
    case 'error':
      return '失败'
    case 'cancelled':
    case 'canceled':
      return '已取消'
    case 'budget_limited':
    case 'budget_exceeded':
      return '超出预算'
    case 'interrupted':
      return '已中断'
    default:
      return state || '子代理'
  }
}

export function workflowStatusLabel(status: string): string {
  switch (status.trim().toLowerCase()) {
    case 'running':
    case 'active':
      return '运行中'
    case 'in_progress':
      return '进行中'
    case 'executing':
      return '执行中'
    case 'planning':
      return '规划中'
    case 'paused':
      return '已暂停'
    case 'complete':
    case 'completed':
      return '完成'
    case 'failed':
    case 'error':
      return '失败'
    case 'cancelled':
    case 'canceled':
      return '已取消'
    case 'budget_limited':
    case 'budget_exceeded':
      return '超出预算'
    default:
      return status
  }
}

/**
 * 会话区只钉运行中的卡 + 最近一次已结束。
 * `items` 按 store 插入序（后写入 = 更新）；已结束取最后一条当最近。
 */
export function partitionWorkflowCards<
  T extends { runId: string; status: string },
>(items: T[]): { live: T[]; latestSettled: T | null; olderSettled: T[] } {
  const live: T[] = []
  const settled: T[] = []
  for (const w of items) {
    if (isWorkflowLive(w.status)) live.push(w)
    else settled.push(w)
  }
  const latestSettled = settled.length > 0 ? settled[settled.length - 1] : null
  const olderSettled = settled.length > 1 ? settled.slice(0, -1).reverse() : []
  return { live, latestSettled, olderSettled }
}

/** 从 summarize_result 的 compact JSON 里按 agent_id 抽出原文。 */
export function parseWorkflowAgentOutputs(raw?: string | null): Map<string, string> {
  const map = new Map<string, string>()
  const t = (raw || '').trim()
  if (!t) return map
  try {
    const v = JSON.parse(t) as unknown
    const items = Array.isArray(v)
      ? v
      : v && typeof v === 'object' && Array.isArray((v as { results?: unknown }).results)
        ? (v as { results: unknown[] }).results
        : v && typeof v === 'object'
          ? [v]
          : []
    for (const item of items) {
      const id = pickAgentId(item)
      const out = pickAgentOutput(item)
      if (id && out) map.set(id, out)
    }
  } catch {
    /* 非 JSON / 截断残片 */
  }
  return map
}

function pickAgentId(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const o = item as Record<string, unknown>
  for (const key of ['agent_id', 'agentId', 'id'] as const) {
    if (typeof o[key] === 'string' && o[key].trim()) return o[key].trim()
  }
  return ''
}

function pickAgentOutput(item: unknown): string {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return ''
  const o = item as Record<string, unknown>
  for (const key of ['output', 'report', 'text', 'summary'] as const) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

/** 官方 summarize_result：未知 object/array 会 to_string() 成一行 compact JSON。 */
export function workflowResultHeadline(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  try {
    return clipHeadline(headlineFromJson(JSON.parse(t)))
  } catch {
    /* 非 JSON，或 16KB 截断后残片 */
  }
  return clipHeadline(cleanResultText(t))
}

function headlineFromJson(v: unknown): string {
  if (typeof v === 'string') return cleanResultText(v)
  if (Array.isArray(v)) {
    const bits = v.map(itemHeadline).filter(Boolean)
    if (bits.length === 0) return v.length > 0 ? `完成 ${v.length} 项` : ''
    if (bits.length === 1) return bits[0]
    return `完成 ${v.length} 项：${bits.join('、')}`
  }
  if (!v || typeof v !== 'object') return ''
  const o = v as Record<string, unknown>
  if (Array.isArray(o.results)) {
    const titles = o.results.map(itemHeadline).filter(Boolean)
    const n = typeof o.count === 'number' ? o.count : o.results.length
    return titles.length ? `完成 ${n} 项：${titles.join('、')}` : `完成 ${n} 项`
  }
  return itemHeadline(o)
}

function itemHeadline(item: unknown): string {
  if (typeof item === 'string') return cleanResultText(item)
  if (!item || typeof item !== 'object') return ''
  const o = item as Record<string, unknown>
  for (const key of ['title', 'output', 'report', 'text', 'summary'] as const) {
    if (typeof o[key] === 'string' && o[key].trim()) return cleanResultText(o[key])
  }
  return ''
}

function cleanResultText(s: string): string {
  return s.replace(/\\n/g, ' ').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()
}

function clipHeadline(s: string): string {
  if (s.length <= RESULT_HEADLINE_MAX) return s
  return `${s.slice(0, RESULT_HEADLINE_MAX)}…`
}

export function fmtWorkflowElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}
