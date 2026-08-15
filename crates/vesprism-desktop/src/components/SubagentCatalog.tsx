import { useStore } from '@nanostores/react'
import { $activeTabId, $subagentCatalogOpen, $subagents, pushToast } from '../store'
import { cancelSubagent } from '../bridge'
import { openSubagentTab } from '../lib/openSubagentTab'
import type { SubagentRuntime } from '../types'

const STATUS_LABEL: Record<SubagentRuntime['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

/**
 * 子代理目录（会话区头部入口；DSH SubagentCatalog 语义）：
 * 本会话派生的子代理分层列表 + 运行中计数徽标 + 打开/取消动作。
 * 数据源 = TabState.subagents（spawn/progress/finished 事件 + 启动对账维护）。
 */
export function SubagentCatalog() {
  const open = useStore($subagentCatalogOpen)
  const subagents = useStore($subagents)
  const running = subagents.filter((s) => s.status === 'running').length

  return (
    <div className="subagent-catalog" role="region" aria-label="子代理">
      <button
        type="button"
        className={`subagent-catalog-toggle${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => $subagentCatalogOpen.set(!open)}
      >
        <span className="subagent-catalog-label">子代理</span>
        <span className={`subagent-count${running > 0 ? ' is-running' : ''}`}>
          {subagents.length}
          {running > 0 && ` · ${running} 运行`}
        </span>
        <span className="subagent-catalog-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="subagent-catalog-panel">
          {subagents.length === 0 ? (
            <p className="subagent-catalog-empty">本会话尚未派生子代理。</p>
          ) : (
            <ul className="subagent-list">
              {subagents.map((s) => (
                <SubagentRow key={s.subagentId} subagent={s} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function SubagentRow({ subagent: s }: { subagent: SubagentRuntime }) {
  const meta: string[] = []
  if (s.durationMs != null) meta.push(fmtDuration(s.durationMs))
  if (s.turnCount != null) meta.push(`${s.turnCount} 轮`)
  if (s.toolCallCount != null) meta.push(`${s.toolCallCount} 工具`)
  if (s.tokensUsed != null) meta.push(`${s.tokensUsed.toLocaleString()} tok`)
  if (s.model) meta.push(s.model)

  const onOpen = async () => {
    if (!s.childSessionId) return
    const tab = await openSubagentTab(s.childSessionId, { title: s.description })
    if (!tab) pushToast('打开子代理失败', 'error')
  }

  const onCancel = async () => {
    try {
      await cancelSubagent($activeTabId.get(), s.subagentId)
      pushToast('已请求取消子代理', 'success')
    } catch (e) {
      pushToast(`取消失败：${String(e)}`, 'error')
    }
  }

  return (
    <li className={`subagent-row is-${s.status}`}>
      <span className={`subagent-dot is-${s.status}`} aria-hidden />
      <div className="subagent-main">
        <span className="subagent-title" title={s.description}>
          {s.description || `子代理 ${s.subagentId.slice(0, 8)}`}
        </span>
        <span className="subagent-meta">{meta.join(' · ')}</span>
        {s.error && <span className="subagent-error">{s.error}</span>}
      </div>
      <span className={`subagent-status is-${s.status}`}>{STATUS_LABEL[s.status]}</span>
      <div className="subagent-actions">
        {s.childSessionId && (
          <button type="button" className="subagent-action" onClick={() => void onOpen()}>
            打开
          </button>
        )}
        {s.status === 'running' && (
          <button type="button" className="subagent-action danger" onClick={() => void onCancel()}>
            取消
          </button>
        )}
      </div>
    </li>
  )
}
