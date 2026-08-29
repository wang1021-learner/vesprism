import type { WorkflowInfoDto } from './composition'
import type { SubagentRuntime } from '../types'
import {
  parseWorkflowAgentOutputs,
  workflowResultHeadline,
} from './workflowCards'

/** 官方 agents[].state：running / done / failed / cancelled。run.status：active / complete / … */
export type DotState = 'ongoing' | 'done' | 'error' | 'warning' | 'idle'

export const ORPHAN_RUN_ID = '__spawn__'
export const EMPTY_PHASE_KEY = ''
export const EMPTY_PHASE_TITLE = '子代理'

export interface MemberRow {
  agentId: string
  label: string
  phase: string | null
  model?: string | null
  state: string
  tokensUsed: number
  durationMs: number
  childSessionId?: string
  output?: string
  turnCount?: number
  toolCallCount?: number
  toolsUsed?: string[]
  /** 官方能力档字符串（read-only/read-write/execute/all），Dock 徽标用 */
  capabilityMode?: string
  /** 是否隔离 worktree，Dock 徽标用 */
  isolation?: boolean
}

export interface PhaseGroup {
  key: string
  title: string
  members: MemberRow[]
}

export interface RunTree {
  runId: string
  name: string
  objective: string
  status: string
  elapsedMs: number
  agentsUsed: number
  agentBudget?: number | null
  resultHeadline: string
  phases: PhaseGroup[]
  runRequiresExpansion: boolean
}

function norm(status: string): string {
  return status.trim().toLowerCase()
}

/** 安静结束：默认折叠。失败/取消仍展开。 */
export function isQuietDone(status: string): boolean {
  const s = norm(status)
  return s === 'complete' || s === 'completed' || s === 'done'
}

export function dotState(status: string): DotState {
  const s = norm(status)
  if (
    s === 'running' ||
    s === 'active' ||
    s === 'in_progress' ||
    s === 'executing' ||
    s === 'planning'
  ) {
    return 'ongoing'
  }
  if (s === 'complete' || s === 'completed' || s === 'done') return 'done'
  if (s === 'failed' || s === 'error') return 'error'
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'interrupted' ||
    s === 'paused' ||
    s === 'user_paused' ||
    s === 'back_off_paused' ||
    s === 'no_progress_paused' ||
    s === 'infra_paused' ||
    s === 'blocked' ||
    s === 'budget_limited' ||
    s === 'budget_exceeded'
  ) {
    return 'warning'
  }
  return 'idle'
}

export function phaseRequiresExpansion(phase: PhaseGroup): boolean {
  return phase.members.some((m) => !isQuietDone(m.state))
}

function runRequiresExpansion(status: string, phases: PhaseGroup[]): boolean {
  return !isQuietDone(status) || phases.some(phaseRequiresExpansion)
}

function indexSubagents(subagents: SubagentRuntime[]): Map<string, SubagentRuntime> {
  const map = new Map<string, SubagentRuntime>()
  for (const s of subagents) {
    if (s.subagentId) map.set(s.subagentId, s)
    if (s.childSessionId) map.set(s.childSessionId, s)
  }
  return map
}

function memberFromAgent(
  a: WorkflowInfoDto['agents'][number],
  subById: Map<string, SubagentRuntime>,
  outputs: Map<string, string>,
): MemberRow {
  const sub = subById.get(a.agentId)
  const output = outputs.get(a.agentId) || sub?.output || undefined
  const child = (sub?.childSessionId || '').trim() || a.agentId.trim()
  return {
    agentId: a.agentId,
    label: (a.label || sub?.description || '').trim() || '子代理',
    phase: a.phase ?? null,
    model: a.model ?? sub?.model ?? null,
    state: a.state,
    tokensUsed: a.tokensUsed,
    durationMs: sub?.durationMs ?? a.durationMs,
    childSessionId: child || undefined,
    output,
    turnCount: sub?.turnCount,
    toolCallCount: sub?.toolCallCount,
    toolsUsed: sub?.toolsUsed,
    capabilityMode: a.capabilityMode ?? undefined,
    isolation: a.isolationWorktree ?? undefined,
  }
}

function memberFromSubagent(s: SubagentRuntime): MemberRow {
  const child = (s.childSessionId || s.subagentId).trim()
  return {
    agentId: s.subagentId,
    label: (s.description || '').trim() || '子代理',
    phase: null,
    model: s.model ?? null,
    state: s.status,
    tokensUsed: s.tokensUsed ?? 0,
    durationMs: s.durationMs ?? 0,
    childSessionId: child || undefined,
    output: s.output || undefined,
    turnCount: s.turnCount,
    toolCallCount: s.toolCallCount,
    toolsUsed: s.toolsUsed,
  }
}

/** 有 phases[] 时按 title 轨道排；否则一整桶「子代理」。 */
export function groupMembersIntoPhases(
  declared: { title: string }[],
  members: MemberRow[],
): PhaseGroup[] {
  const titles = declared.map((p) => p.title.trim()).filter(Boolean)
  if (titles.length === 0) {
    return members.length === 0
      ? []
      : [{ key: EMPTY_PHASE_KEY, title: EMPTY_PHASE_TITLE, members }]
  }
  const used = new Set<string>()
  const phases: PhaseGroup[] = []
  for (const title of titles) {
    const list = members.filter((m) => (m.phase || '') === title)
    if (list.length === 0) continue
    used.add(title)
    phases.push({ key: title, title, members: list })
  }
  const rest = new Map<string, MemberRow[]>()
  for (const m of members) {
    const key = m.phase || EMPTY_PHASE_KEY
    if (used.has(key)) continue
    const list = rest.get(key) ?? []
    list.push(m)
    rest.set(key, list)
  }
  for (const [key, list] of rest) {
    phases.push({
      key,
      title: key || EMPTY_PHASE_TITLE,
      members: list,
    })
  }
  return phases
}

export function buildRunTree(
  workflow: WorkflowInfoDto,
  subagents: SubagentRuntime[],
): RunTree {
  const subById = indexSubagents(subagents)
  const outputs = parseWorkflowAgentOutputs(workflow.resultSummary)
  const agents = Array.isArray(workflow.agents) ? workflow.agents : []
  const members = agents
    .filter((a) => (a.agentId || '').trim())
    .map((a) => memberFromAgent(a, subById, outputs))
  const phases = groupMembersIntoPhases(workflow.phases ?? [], members)
  const headline = workflow.resultSummary
    ? workflowResultHeadline(workflow.resultSummary)
    : ''
  return {
    runId: workflow.runId,
    name: workflow.name,
    objective: workflow.objective,
    status: workflow.status,
    elapsedMs: workflow.elapsedMs,
    agentsUsed: members.length || workflow.agentsUsed,
    agentBudget: workflow.agentBudget,
    resultHeadline: headline && headline !== 'done' ? headline : '',
    phases,
    runRequiresExpansion: runRequiresExpansion(workflow.status, phases),
  }
}

function buildOrphanTree(orphans: SubagentRuntime[]): RunTree {
  const members = orphans.map(memberFromSubagent)
  const phases = groupMembersIntoPhases([], members)
  const status = members.some((m) => norm(m.state) === 'running') ? 'active' : 'complete'
  return {
    runId: ORPHAN_RUN_ID,
    name: '派生子代理',
    objective: '',
    status,
    elapsedMs: 0,
    agentsUsed: members.length,
    agentBudget: null,
    resultHeadline: '',
    phases,
    runRequiresExpansion: runRequiresExpansion(status, phases),
  }
}

/**
 * 每条 workflow 一棵树。agents 认领过的 id 不再进散装桶。
 * 没被认领的 spawn_subagent（含没有 workflow 时）合成「派生子代理」。
 */
export function buildRunForest(
  workflows: WorkflowInfoDto[],
  subagents: SubagentRuntime[],
): RunTree[] {
  const claimed = new Set<string>()
  const trees: RunTree[] = []
  for (const w of workflows) {
    for (const a of w.agents ?? []) {
      if (a.agentId) claimed.add(a.agentId)
    }
    trees.push(buildRunTree(w, subagents))
  }
  if (trees.length === 0) {
    return subagents.length > 0 ? [buildOrphanTree(subagents)] : []
  }
  const orphans = subagents.filter((s) => {
    const id = (s.subagentId || '').trim()
    const child = (s.childSessionId || '').trim()
    if (id && claimed.has(id)) return false
    if (child && claimed.has(child)) return false
    return Boolean(id)
  })
  if (orphans.length > 0) {
    const solo = trees.length === 1 ? trees[0] : null
    const soloEmpty = Boolean(solo && solo.phases.every((p) => p.members.length === 0))
    if (solo && soloEmpty) {
      const folded = buildOrphanTree(orphans)
      trees[0] = {
        ...solo,
        phases: folded.phases,
        agentsUsed: folded.agentsUsed,
        runRequiresExpansion: runRequiresExpansion(solo.status, folded.phases),
      }
    } else {
      trees.push(buildOrphanTree(orphans))
    }
  }
  trees.sort((a, b) => {
    const ar = a.runRequiresExpansion ? 0 : 1
    const br = b.runRequiresExpansion ? 0 : 1
    if (ar !== br) return ar - br
    if (a.runId === ORPHAN_RUN_ID) return 1
    if (b.runId === ORPHAN_RUN_ID) return -1
    return a.runId < b.runId ? 1 : -1
  })
  return trees
}
