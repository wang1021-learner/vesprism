/**
 * 组装单 `flows` 白名单：有挂载列表时，未挂载的具名工作流不要发出去。
 * `/workflow pause|resume|stop|list|save` 始终放行。
 */
import { isNamedWorkflowSlash } from '../workbench/flow/namedWorkflowSlash'
import { isValidFlowId } from '../workbench/flow/types'

const WORKFLOW_CONTROL = new Set([
  'pause',
  'resume',
  'stop',
  'list',
  'save',
  'runs',
])

export type WorkflowInvocation =
  | { kind: 'none' }
  | { kind: 'control' }
  | { kind: 'named'; id: string }

function firstLine(text: string): string {
  return (text || '').trim().split(/\r?\n/, 1)[0]?.trim() || ''
}

export function parseWorkflowInvocation(text: string): WorkflowInvocation {
  const t = firstLine(text)
  if (!t.startsWith('/')) return { kind: 'none' }
  const wf = t.match(/^\/workflow(?:\s+(.*))?$/i)
  if (wf) {
    const rest = (wf[1] || '').trim()
    if (!rest) return { kind: 'control' }
    const verb = rest.split(/\s+/, 1)[0]?.replace(/\{.*$/, '') || ''
    const lower = verb.toLowerCase()
    if (WORKFLOW_CONTROL.has(lower)) return { kind: 'control' }
    if (isValidFlowId(lower)) return { kind: 'named', id: lower }
    return { kind: 'control' }
  }
  if (isNamedWorkflowSlash(t)) {
    const m = t.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)/)
    if (m?.[1]) return { kind: 'named', id: m[1] }
  }
  return { kind: 'none' }
}

export function workflowSendAllowed(
  text: string,
  mountedFlows: readonly string[] | undefined,
): { ok: true } | { ok: false; id: string } {
  const inv = parseWorkflowInvocation(text)
  if (inv.kind !== 'named') return { ok: true }
  const allow = (mountedFlows || []).map((s) => s.trim()).filter(Boolean)
  if (allow.length === 0) return { ok: true }
  if (allow.includes(inv.id)) return { ok: true }
  return { ok: false, id: inv.id }
}
