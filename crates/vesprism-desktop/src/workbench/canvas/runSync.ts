/**
 * 试跑回填：按流程 id / runId 认 run，按节点 id 认 phase。
 */
import type { WorkflowInfoDto } from '../../lib/composition'
import { parseWorkflowAgentOutputs } from '../../lib/workflowCards'
import type { FlowRunStep } from '../flow'

export type SubmittedRun = {
  keys: Set<string>
  /** 提交时的流程 id（从此处重跑可能带 -rerun） */
  id: string
  /** 画布主流程 id */
  baseId: string
  name: string
}

export type SubmittedRunDto = {
  keys: string[]
  id: string
  baseId: string
  name: string
}

export function serializeSubmittedRun(s: SubmittedRun): SubmittedRunDto {
  return { keys: [...s.keys], id: s.id, baseId: s.baseId, name: s.name }
}

export function deserializeSubmittedRun(s: SubmittedRunDto | null | undefined): SubmittedRun | null {
  if (!s?.id) return null
  return {
    keys: new Set(s.keys ?? []),
    id: s.id,
    baseId: s.baseId || s.id,
    name: s.name || '',
  }
}

export function normalizeFlowName(name: string): string {
  return (name || '').trim().replace(/^\//, '')
}

export function workflowBelongsToRun(w: { runId: string; name: string }, submitted: SubmittedRun): boolean {
  if (submitted.keys.has(w.runId)) return false
  const n = normalizeFlowName(w.name)
  const id = normalizeFlowName(submitted.id)
  const base = normalizeFlowName(submitted.baseId)
  // 从此处重跑只用 *-rerun id，避免本流程另一次全量试跑投影过来。
  if (id && base && id !== base) return n === id
  return n === id || n === base
}

export function pickNewRuns(
  workflows: Record<string, WorkflowInfoDto>,
  submitted: SubmittedRun,
): WorkflowInfoDto[] {
  return Object.values(workflows).filter((w) => workflowBelongsToRun(w, submitted))
}

export function matchStepPhase(
  phases: Array<{ title: string; state: string }>,
  step: Pick<FlowRunStep, 'nodeId' | 'label'>,
): { title: string; state: string } | undefined {
  const id = step.nodeId
  const exact = phases.find((p) => p.title === id || p.title.endsWith(` · ${id}`))
  if (exact) return exact
  const byLabel = phases.filter(
    (p) => p.title === step.label || p.title.startsWith(`${step.label} ·`),
  )
  return byLabel.length === 1 ? byLabel[0] : undefined
}

export function isCurrentPhase(
  currentPhase: string | null | undefined,
  step: Pick<FlowRunStep, 'nodeId' | 'label'>,
): boolean {
  const cur = (currentPhase || '').trim()
  if (!cur) return false
  return cur === step.nodeId || cur.endsWith(` · ${step.nodeId}`)
}

export function runFingerprint(w: WorkflowInfoDto): string {
  return `${w.runId}:${w.revision}:${w.phases.map((p) => `${p.title}:${p.state}`).join('|')}:${w.currentPhase || ''}:${w.lastEvent || ''}`
}

export function dockRunStatus(
  steps: Array<{ status: string }>,
): '失败' | '运行中' | '进行中' | '完成' | '待运行' {
  if (steps.length === 0) return '待运行'
  if (steps.some((s) => s.status === 'failed')) return '失败'
  if (steps.some((s) => s.status === 'running')) return '运行中'
  if (steps.some((s) => s.status === 'pending')) return '进行中'
  if (steps.some((s) => s.status === 'completed')) return '完成'
  return '进行中'
}

export function applyRunToSteps(
  steps: FlowRunStep[],
  run: WorkflowInfoDto,
): { steps: FlowRunStep[]; outputs: Array<{ nodeId: string; output: unknown; status: string }> } {
  const summary = parseWorkflowAgentOutputs(run.resultSummary)
  const outputs: Array<{ nodeId: string; output: unknown; status: string }> = []
  const next = steps.map((s) => {
    const phase = matchStepPhase(run.phases, s)
    if (!phase) {
      const fromSummary = summary.get(s.nodeId)
      if (fromSummary && fromSummary !== s.output) {
        outputs.push({ nodeId: s.nodeId, output: fromSummary, status: s.status })
        return { ...s, output: fromSummary }
      }
      return s
    }
    const status =
      phase.state === 'completed'
        ? 'completed'
        : phase.state === 'running'
          ? 'running'
          : phase.state === 'failed'
            ? 'failed'
            : s.status
    const current = isCurrentPhase(run.currentPhase, s)
    const fromSummary = summary.get(s.nodeId)
    const detail = run.lastEventDetail
    let output = s.output
    if (current && detail != null) output = detail
    else if (fromSummary) output = fromSummary
    if (output !== undefined && output !== s.output) {
      outputs.push({ nodeId: s.nodeId, output, status })
    } else if (current && detail != null) {
      outputs.push({ nodeId: s.nodeId, output: detail, status })
    }
    if (status === s.status && output === s.output) return s
    return { ...s, status, output }
  })
  return { steps: next, outputs }
}
