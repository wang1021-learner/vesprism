import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $subagents, $workflows, pushToast } from '../store'
import type { SubagentRuntime } from '../types'
import type { WorkflowInfoDto } from '../lib/composition'
import { cancelSubagentChild } from '../lib/cancelSubagentChild'
import { openSubagentTab, refreshSubagentTabMessages } from '../lib/openSubagentTab'
import { formatSubagentLiveMeta } from '../lib/subagentMessage'
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

/** 会话区三层树：run → phase → 子代理。散装 spawn 合成「派生子代理」。 */
export function SubagentRunTree({
  workflows,
  subagents,
  readonly = false,
  onViewConversation,
}: {
  /** 传入则用传入数据（试跑详情面板）；缺省用活跃 tab 投影 */
  workflows?: WorkflowInfoDto[]
  subagents?: SubagentRuntime[]
  /** 只读：不取消、不进编码壳聊天；对话走 onViewConversation */
  readonly?: boolean
  /** 试跑详情：在本页打开只读对话，避免新开编码 Tab 把工作台切走 */
  onViewConversation?: (m: MemberRow) => void
} = {}) {
  const storeWorkflows = useStore($workflows)
  const storeSubagents = useStore($subagents)
  const list = workflows ?? Object.values(storeWorkflows)
  const subs = subagents ?? storeSubagents
  const forest = buildRunForest(list, subs)
  if (forest.length === 0) return null
  return (
    <div className="st-list" role="region" aria-label="子代理">
      {forest.map((tree) => (
        <RunView
          key={tree.runId}
          tree={tree}
          readonly={readonly}
          onViewConversation={onViewConversation}
        />
      ))}
    </div>
  )
}

function Dot({ state }: { state: ReturnType<typeof dotState> }) {
  return <span className={`st-dot is-${state}`} aria-hidden />
}

/** 岗位标签 → 中文徽标（工作流上报的 capability_mode，仅展示）。 */
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

function RunView({
  tree,
  readonly,
  onViewConversation,
}: {
  tree: RunTree
  readonly: boolean
  onViewConversation?: (m: MemberRow) => void
}) {
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
            tree.phases.map((p) => (
              <PhaseView
                key={p.key || p.title}
                phase={p}
                readonly={readonly}
                onViewConversation={onViewConversation}
              />
            ))
          )}
        </div>
      ) : null}
      {tree.resultHeadline ? <div className="st-result">{tree.resultHeadline}</div> : null}
    </div>
  )
}

function PhaseView({
  phase,
  readonly,
  onViewConversation,
}: {
  phase: PhaseGroup
  readonly: boolean
  onViewConversation?: (m: MemberRow) => void
}) {
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
            <MemberRowView
              key={m.agentId}
              m={m}
              readonly={readonly}
              onViewConversation={onViewConversation}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MemberRowView({
  m,
  readonly,
  onViewConversation,
}: {
  m: MemberRow
  readonly: boolean
  onViewConversation?: (m: MemberRow) => void
}) {
  const [opening, setOpening] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(false)
  const preview = m.output ? workflowResultHeadline(m.output) : ''
  const live = dotState(m.state) === 'ongoing'
  const liveMeta = formatSubagentLiveMeta({
    durationMs: m.durationMs,
    turnCount: m.turnCount,
    toolCallCount: m.toolCallCount,
    toolsUsed: m.toolsUsed,
  })
  const onCancel = async () => {
    if (!m.agentId || cancelling || !live) return
    setCancelling(true)
    try {
      await cancelSubagentChild(m.agentId)
    } finally {
      setCancelling(false)
    }
  }
  const onOpen = async () => {
    if (onViewConversation) {
      onViewConversation(m)
      return
    }
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
        {live && !readonly ? (
          <button
            type="button"
            className="st-action is-cancel"
            disabled={cancelling}
            onClick={() => void onCancel()}
            title="只停这个帮手"
          >
            {cancelling ? '…' : '取消'}
          </button>
        ) : null}
        {m.childSessionId || m.output ? (
          <button
            type="button"
            className="st-action"
            disabled={opening}
            onClick={() => void onOpen()}
            title={
              readonly || onViewConversation
                ? '在本页查看该子代理对话'
                : '查看该子代理完整交互与工具调用对话流'
            }
          >
            {opening ? '…' : readonly || onViewConversation ? '对话' : '打开'}
          </button>
        ) : null}
      </div>
      {live && liveMeta ? (
        <div className="st-member-preview" title={liveMeta}>
          {liveMeta}
        </div>
      ) : null}
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
