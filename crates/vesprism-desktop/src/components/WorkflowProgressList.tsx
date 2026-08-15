import { useStore } from '@nanostores/react'
import { $workflows } from '../store'
import type { WorkflowInfoDto } from '../lib/composition'

const RUNNING = new Set(['running', 'active', 'in_progress', 'executing', 'planning'])

function fmtElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

/** 会话区工作流运行进度卡列表（官方 WorkflowUpdated 投影）。 */
export function WorkflowProgressList() {
  const workflows = useStore($workflows)
  const items = Object.values(workflows)
  if (items.length === 0) return null
  // 运行中的在前，其余按 runId 稳定排序。
  const sorted = [...items].sort((a, b) => {
    const ar = RUNNING.has(a.status) ? 0 : 1
    const br = RUNNING.has(b.status) ? 0 : 1
    if (ar !== br) return ar - br
    return a.runId.localeCompare(b.runId)
  })
  return (
    <div className="wf-progress-list" role="status" aria-label="工作流运行进度">
      {sorted.map((w) => (
        <WorkflowCard key={w.runId} workflow={w} />
      ))}
    </div>
  )
}

function WorkflowCard({ workflow: w }: { workflow: WorkflowInfoDto }) {
  const running = RUNNING.has(w.status)
  return (
    <div className={`wf-card${running ? ' is-running' : ''}`}>
      <div className="wf-card-head">
        <span className="wf-card-name">{w.name}</span>
        <span className={`wf-card-status ${running ? 'wf-status-running' : ''}`}>{w.status}</span>
        <span className="wf-card-meta">
          {fmtElapsed(w.elapsedMs)}
          {w.agentsUsed > 0 && ` · ${w.agentsUsed} agent`}
          {w.activeAgents > 0 && ` · 活跃 ${w.activeAgents}`}
        </span>
      </div>
      {w.objective && <div className="wf-card-objective">{w.objective}</div>}
      {w.currentAgentLabel && (
        <div className="wf-card-agent">当前：{w.currentAgentLabel}</div>
      )}
      {w.phases.length > 0 && (
        <div className="wf-card-phases">
          {w.phases.map((p, i) => (
            <span
              key={`${p.title}-${i}`}
              className={`wf-phase ${p.state === 'completed' ? 'is-done' : p.state === 'running' ? 'is-running' : ''}`}
              title={p.state}
            >
              {p.title}
            </span>
          ))}
        </div>
      )}
      {w.lastEvent && (
        <div className="wf-card-last">
          {w.lastEvent}
          {w.lastEventDetail ? `：${w.lastEventDetail}` : ''}
        </div>
      )}
      {w.pauseMessage && <div className="wf-card-pause">{w.pauseMessage}</div>}
      {w.resultSummary && <div className="wf-card-result">{w.resultSummary}</div>}
    </div>
  )
}
