/**
 * 具名工作流斜杠：对齐官方 `parse_named_workflow_args`。
 * 旗标在 JSON 前面；effort / agent_budget 只走旗标，不写进 JSON。
 */
import { isValidFlowId } from './types'

const WORKFLOW_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

/** 官方 `parse_leading_arg`：`--flag value` 或 `--flag=value`。 */
const WORKFLOW_FLAG =
  /^--(effort|agent-budget)(?:=|\s+)(\S+)(?:\s+|$)/i

export function isWorkflowEffort(value: string): boolean {
  return WORKFLOW_EFFORTS.has(value.trim().toLowerCase())
}

/**
 * 画布试跑发出的 `/{id} [--effort …] [--agent-budget …] [{json}]`。
 * 必须认旗标，否则默认 medium 的 `--effort` 会让试跑日志漏进对话、误触发认图。
 * 不把 `/app/src/auth.ts`、`/goal 做个流程` 这类用户原话当试跑。
 */
export function isNamedWorkflowSlash(text: string): boolean {
  const t = (text || '').trim()
  if (!t.startsWith('/')) return false
  const firstTok = t.split(/\s/, 1)[0] ?? ''
  if (firstTok.includes('/', 1)) return false
  const m = t.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$|\{)/)
  if (!m || !isValidFlowId(m[1])) return false
  let rest = t.slice(m[0].length).trim()
  for (let n = 0; n < 8 && rest.startsWith('--'); n++) {
    const flag = rest.match(WORKFLOW_FLAG)
    if (!flag) return false
    rest = rest.slice(flag[0].length).trim()
  }
  return !rest || rest.startsWith('{')
}

/** 画布侧：这条用户消息是不是试跑斜杠（对话过滤 / 认图跳过共用）。 */
export function isFlowRunUserText(text: string): boolean {
  return isNamedWorkflowSlash(text)
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
