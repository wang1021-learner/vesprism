/**
 * 具名工作流斜杠：对齐官方 `parse_named_workflow_args`。
 * 旗标在 JSON 前面；effort / agent_budget 只走旗标，不写进 JSON。
 */

const WORKFLOW_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export function isWorkflowEffort(value: string): boolean {
  return WORKFLOW_EFFORTS.has(value.trim().toLowerCase())
}

export function buildNamedWorkflowSlash(opts: {
  id: string
  input?: unknown
  effort?: string | null
  agentBudget?: number | null
}): string {
  const id = opts.id.replace(/^\/+/, '').trim()
  const parts = [`/${id}`]
  const effort = (opts.effort || '').trim().toLowerCase()
  if (effort && isWorkflowEffort(effort)) {
    parts.push(`--effort ${effort}`)
  }
  const budget = opts.agentBudget
  if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 1) {
    parts.push(`--agent-budget ${Math.floor(budget)}`)
  }
  if (hasLaunchArgs(opts.input)) {
    parts.push(JSON.stringify(opts.input))
  }
  return parts.join(' ')
}

function hasLaunchArgs(input: unknown): boolean {
  if (input == null) return false
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.keys(input as object).length > 0
  }
  return true
}
