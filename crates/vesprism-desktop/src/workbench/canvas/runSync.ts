/**
 * 试跑回填：按流程 id / runId 认 run，按节点 id 认 phase。
 */
import type { WorkflowInfoDto } from '../../lib/composition'
import type { FlowRunStep } from '../flow'

export type SubmittedRun = {
  keys: Set<string>
  /** 提交时的流程 id（从此处重跑可能带 -rerun） */
  id: string
  /** 画布主流程 id */
  baseId: string
  name: string
}

export function normalizeFlowName(name: string): string {
  return (name || '').trim().replace(/^\//, '')
}

export function workflowBelongsToRun(w: { runId: string; name: string }, submitted: SubmittedRun): boolean {
  if (submitted.keys.has(w.runId)) return false
  const n = normalizeFlowName(w.name)
  const id = normalizeFlowName(submitted.id)
  const base = normalizeFlowName(submitted.baseId)
  return n === id || n === base || n === submitted.name
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
  const byId = phases.find((p) => p.title.includes(step.nodeId))
  if (byId) return byId
  return phases.find((p) => p.title === step.label || p.title.startsWith(`${step.label} `))
}

export function runFingerprint(w: WorkflowInfoDto): string {
  return `${w.runId}:${w.revision}:${w.phases.map((p) => `${p.title}:${p.state}`).join('|')}:${w.currentPhase || ''}:${w.lastEvent || ''}`
}

export function applyRunToSteps(
  steps: FlowRunStep[],
  run: WorkflowInfoDto,
): { steps: FlowRunStep[]; outputs: Array<{ nodeId: string; output: unknown }> } {
  const outputs: Array<{ nodeId: string; output: unknown }> = []
  const next = steps.map((s) => {
    const phase = matchStepPhase(run.phases, s)
    if (!phase) return s
    const status =
      phase.state === 'completed'
        ? 'completed'
        : phase.state === 'running'
          ? 'running'
          : phase.state === 'failed'
            ? 'failed'
            : s.status
    const current = (run.currentPhase || '').includes(s.nodeId) || run.currentPhase === s.label
    const output = current ? (run.lastEventDetail ?? s.output) : s.output
    if (phase.state === 'completed' && current && run.lastEventDetail !== undefined) {
      outputs.push({ nodeId: s.nodeId, output: run.lastEventDetail })
    }
    if (status === s.status && output === s.output) return s
    return { ...s, status, output }
  })
  return { steps: next, outputs }
}
