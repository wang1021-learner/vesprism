import { useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $recentWorkflows, clearRecentWorkflows } from '../../store'
import { SubagentRunTree } from '../../components/SubagentRunTree'
import { workflowStatusLabel } from '../../lib/workflowCards'

export default function RunDetailPanel() {
  const recent = useStore($recentWorkflows)
  // 插入顺序 ≈ 首次出现顺序；反转后最新在前
  const runs = useMemo(() => Object.values(recent).reverse(), [recent])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null

  if (runs.length === 0) {
    return (
      <div className="run-detail-panel">
        <div className="run-detail-empty">
          还没有试跑记录。在流程画布点「▶ 试跑」后，这里会展示完整的运行详情（支持跨会话持久化）。
        </div>
      </div>
    )
  }

  const completed = (selected?.agents ?? []).filter((a) => a.state === 'done').length
  const total = selected?.agents?.length ?? 0

  return (
    <div className="run-detail-panel" role="region" aria-label="试跑详情">
      <header className="run-detail-head">
        <div className="run-detail-title">
          <span className="run-detail-title-label">试跑详情</span>
          <select
            className="run-detail-select"
            value={selected.runId}
            aria-label="切换运行"
            onChange={(e) => setSelectedRunId(e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.name} · {workflowStatusLabel(r.status)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="run-detail-clear-btn"
            title="清空全部历史试跑记录"
            onClick={() => {
              if (window.confirm('确认清空所有历史试跑记录？')) {
                clearRecentWorkflows()
                setSelectedRunId(null)
              }
            }}
          >
            清空历史
          </button>
        </div>
        <span className={`run-detail-status is-${selected.status}`}>
          {workflowStatusLabel(selected.status)}
        </span>
      </header>

      <div className="run-detail-overview">
        <div className="run-detail-ov-item">
          <span className="run-detail-ov-label">流程</span>
          <span className="run-detail-ov-value">{selected.name || selected.runId}</span>
        </div>
        <div className="run-detail-ov-item">
          <span className="run-detail-ov-label">子代理</span>
          <span className="run-detail-ov-value">
            {total > 0 ? `${completed}/${total} 完成` : '—'}
          </span>
        </div>
        <div className="run-detail-ov-item">
          <span className="run-detail-ov-label">目标</span>
          <span className="run-detail-ov-value">{selected.objective || '—'}</span>
        </div>
      </div>

      <div className="run-detail-tree scrollbar-dt">
        <SubagentRunTree workflows={selected ? [selected] : []} readonly />
      </div>
    </div>
  )
}
