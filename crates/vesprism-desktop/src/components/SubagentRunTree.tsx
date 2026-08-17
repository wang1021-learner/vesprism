import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $subagents, $workflows, pushToast } from '../store'
import { openSubagentTab, refreshSubagentTabMessages } from '../lib/openSubagentTab'
import {
  RESULT_EXPAND_MAX,
  fmtWorkflowElapsed,
  workflowAgentStateLabel,
  workflowResultHeadline,
  workflowStatusLabel,
} from '../lib/workflowCards'
import {
  buildRunForest,
  dotState,
  phaseRequiresExpansion,
  type MemberRow,
  type PhaseGroup,
  type RunTree,
} from '../lib/subagentRunTree'

/** 会话区三层树：run → phase → 子代理。有 workflow 才画；散装 spawn 见顶栏目录。 */
export function SubagentRunTree() {
  const workflows = useStore($workflows)
  const subagents = useStore($subagents)
  const forest = buildRunForest(Object.values(workflows), subagents)
  if (forest.length === 0) return null
  return (
    <div className="st-list" role="region" aria-label="子代理">
      {forest.map((tree) => (
        <RunView key={tree.runId} tree={tree} />
      ))}
    </div>
  )
}

function Dot({ state }: { state: ReturnType<typeof dotState> }) {
  return <span className={`st-dot is-${state}`} aria-hidden />
}

/** 能力档 → 中文徽标（官方 capability_mode 字符串）。 */
function capabilityLabel(mode: string): string {
  switch (mode) {
    case 'read-only':
      return '只读'
    case 'read-write':
      return '可改'
    case 'execute':
      return '能跑'
    case 'all':
      return '全权'
    default:
      return mode
  }
}

function capabilityClass(mode: string): string {
  switch (mode) {
    case 'read-only':
      return 'is-readonly'
    case 'read-write':
      return 'is-readwrite'
    case 'execute':
      return 'is-execute'
    case 'all':
      return 'is-all'
    default:
      return 'is-unknown'
  }
}

function RunView({ tree }: { tree: RunTree }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const shown = userOpen ?? tree.runRequiresExpansion
  return (
    <div className="st-run" data-status={tree.status}>
      <button
        type="button"
        className="st-run-head"
        aria-expanded={shown}
        onClick={() => setUserOpen(!(userOpen ?? tree.runRequiresExpansion))}
      >
        <span className="st-chevron">{shown ? '▾' : '▸'}</span>
        <Dot state={dotState(tree.status)} />
        <span className="st-run-name">{tree.name}</span>
        <span className="st-run-meta">
          {fmtWorkflowElapsed(tree.elapsedMs)}
          {tree.agentsUsed > 0 && ` · ${tree.agentsUsed} agent`}
          {tree.agentBudget ? ` / ${tree.agentBudget}` : ''}
        </span>
        <span className="st-status">{workflowStatusLabel(tree.status)}</span>
      </button>
      {tree.objective ? <div className="st-objective">{tree.objective}</div> : null}
      {shown ? (
        <div className="st-phase-list">
          {tree.phases.length === 0 ? (
            <span className="st-empty">暂无子代理</span>
          ) : (
            tree.phases.map((p) => <PhaseView key={p.key || p.title} phase={p} />)
          )}
        </div>
      ) : null}
      {tree.resultHeadline ? <div className="st-result">{tree.resultHeadline}</div> : null}
    </div>
  )
}

function PhaseView({ phase }: { phase: PhaseGroup }) {
  const requires = phaseRequiresExpansion(phase)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const shown = userOpen ?? requires
  const done = phase.members.filter((m) => dotState(m.state) === 'done').length
  const failed = phase.members.filter((m) => dotState(m.state) === 'error').length
  return (
    <div className="st-phase" data-open={shown}>
      <button
        type="button"
        className="st-phase-head"
        aria-expanded={shown}
        onClick={() => setUserOpen(!(userOpen ?? requires))}
      >
        <span className="st-chevron">{shown ? '▾' : '▸'}</span>
        <span className="st-phase-title">{phase.title}</span>
        <span className="st-phase-count">{phase.members.length} 个</span>
        <span className="st-phase-summary">
          {done > 0 ? `${done} 完成` : ''}
          {failed > 0 ? `${done > 0 ? ' · ' : ''}${failed} 失败` : ''}
        </span>
      </button>
      {shown ? (
        <div className="st-members">
          {phase.members.map((m) => (
            <MemberRowView key={m.agentId} m={m} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MemberRowView({ m }: { m: MemberRow }) {
  const [opening, setOpening] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(false)
  const preview = m.output ? workflowResultHeadline(m.output) : ''
  const onOpen = async () => {
    if (!m.childSessionId || opening) return
    setOpening(true)
    try {
      const tab = await openSubagentTab(m.childSessionId, { title: m.label })
      if (!tab) {
        pushToast('打开子代理失败', 'error')
        return
      }
      if (m.output) {
        await refreshSubagentTabMessages(m.childSessionId, { outputFallback: m.output })
      }
    } finally {
      setOpening(false)
    }
  }
  return (
    <div className="st-member" data-state={m.state}>
      <div className="st-member-row">
        <Dot state={dotState(m.state)} />
        <span className="st-label" title={m.label}>
          {m.label}
        </span>
        {m.capabilityMode ? (
          <span className={`st-cap ${capabilityClass(m.capabilityMode)}`} title={`能力档：${m.capabilityMode}`}>
            {capabilityLabel(m.capabilityMode)}
          </span>
        ) : null}
        {m.isolation ? (
          <span className="st-cap is-iso" title="在隔离 git worktree 里跑，不碰主仓库">
            隔离
          </span>
        ) : null}
        <span className="st-member-meta">
          {m.durationMs > 0 ? fmtWorkflowElapsed(m.durationMs) : ''}
          {m.model ? `${m.durationMs > 0 ? ' · ' : ''}${m.model}` : ''}
        </span>
        <span className="st-status">{workflowAgentStateLabel(m.state)}</span>
        {m.output ? (
          <button
            type="button"
            className="st-action"
            onClick={() => setBodyOpen((v) => !v)}
          >
            {bodyOpen ? '收起' : '结果'}
          </button>
        ) : null}
        {m.childSessionId ? (
          <button
            type="button"
            className="st-action"
            disabled={opening}
            onClick={() => void onOpen()}
          >
            {opening ? '…' : '打开'}
          </button>
        ) : null}
      </div>
      {!bodyOpen && preview ? <div className="st-member-preview">{preview}</div> : null}
      {bodyOpen && m.output ? (
        <pre className="st-member-output">
          {m.output.length > RESULT_EXPAND_MAX
            ? `${m.output.slice(0, RESULT_EXPAND_MAX)}\n…已截断`
            : m.output}
        </pre>
      ) : null}
    </div>
  )
}
