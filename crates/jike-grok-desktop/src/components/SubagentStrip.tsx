/**
 * 多 Agent 父侧条
 * - 一期：列表 + 运行状态
 * - 二期：详情面板 + get_subagent 刷新 + 取消
 * - 三期：新标签打开子会话
 */
import { useStore } from '@nanostores/react'
import { memo, useCallback, useMemo, useState } from 'react'
import {
  $activeTabId,
  $subagents,
  patchActiveTab,
  patchTab,
  pushToast,
  upsertSubagent,
} from '../store'
import type { SubagentRuntime } from '../types'
import { cancelSubagent, getSubagent, getSessionMessages } from '../bridge'
import { openSubagentTab } from '../lib/openSubagentTab'
import { parseSubagentSnap } from '../lib/parseSubagentSnap'

function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m${rem}s` : `${m}m`
}

function statusLabel(s: SubagentRuntime['status']): string {
  switch (s) {
    case 'running':
      return '运行中'
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return s
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'user':
      return '用户'
    case 'assistant':
      return '助手'
    case 'thought':
      return '思考'
    case 'tool':
      return '工具'
    case 'system':
      return '系统'
    default:
      return role
  }
}

type TranscriptLine = { id: string; role: string; text: string }

const SubagentChip = memo(function SubagentChip({
  item,
  selected,
  onSelect,
}: {
  item: SubagentRuntime
  selected: boolean
  onSelect: () => void
}) {
  const running = item.status === 'running'
  return (
    <button
      type="button"
      className={`subagent-chip status-${item.status}${selected ? ' is-selected' : ''}`}
      title={item.description || item.subagentType}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={`subagent-dot${running ? ' is-live' : ''}`} aria-hidden />
      <span className="subagent-type">{item.subagentType || 'subagent'}</span>
      <span className="subagent-desc">
        {item.description || item.childSessionId || item.subagentId}
      </span>
      <span className="subagent-status">{statusLabel(item.status)}</span>
      {typeof item.turnCount === 'number' && item.turnCount > 0 ? (
        <span className="subagent-meta">{item.turnCount}t</span>
      ) : null}
      {item.durationMs ? (
        <span className="subagent-meta">{formatDuration(item.durationMs)}</span>
      ) : null}
    </button>
  )
})

export const SubagentStrip = memo(function SubagentStrip() {
  const list = useStore($subagents)
  const tabId = useStore($activeTabId)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lines, setLines] = useState<TranscriptLine[]>([])

  const sorted = useMemo(() => {
    return list
      .slice()
      .sort((a, b) => {
        const ar = a.status === 'running' ? 1 : 0
        const br = b.status === 'running' ? 1 : 0
        if (ar !== br) return br - ar
        return (b.durationMs ?? 0) - (a.durationMs ?? 0)
      })
  }, [list])

  const detail = useMemo(() => {
    if (!detailId) return null
    return list.find((a) => a.subagentId === detailId) ?? null
  }, [detailId, list])

  const finishedCount = useMemo(
    () => list.filter((s) => s.status !== 'running').length,
    [list],
  )

  const loadDetailTranscript = useCallback(async (agent: SubagentRuntime) => {
    if (!agent.childSessionId) {
      setLines([])
      return
    }
    try {
      const raw = await getSessionMessages(agent.childSessionId)
      const mapped: TranscriptLine[] = (raw || [])
        .slice(-48)
        .map((m: { id?: string; role?: string; text?: string }, i: number) => ({
          id: m.id || `line_${i}`,
          role: m.role || 'assistant',
          text: (m.text || '').slice(0, 800),
        }))
        .filter((m: TranscriptLine) => m.text.trim())
      setLines(mapped)
    } catch {
      setLines([])
    }
  }, [])

  const openDetail = useCallback(
    (agent: SubagentRuntime) => {
      setDetailId((prev) => {
        if (prev === agent.subagentId) {
          setLines([])
          return null
        }
        void loadDetailTranscript(agent)
        return agent.subagentId
      })
    },
    [loadDetailTranscript],
  )

  const onRefresh = useCallback(async () => {
    if (!tabId || !detail) return
    setRefreshing(true)
    try {
      const snap = await getSubagent(tabId, detail.subagentId, false)
      const patch = parseSubagentSnap(snap, detail)
      upsertSubagent(tabId, patch)
      await loadDetailTranscript({ ...detail, ...patch })
      pushToast('已刷新子任务状态', 'success')
    } catch (e) {
      pushToast(`刷新失败 · ${String(e)}`, 'error')
    } finally {
      setRefreshing(false)
    }
  }, [tabId, detail, loadDetailTranscript])

  const onCancel = useCallback(async () => {
    if (!tabId || !detail || detail.status !== 'running') return
    try {
      await cancelSubagent(tabId, detail.subagentId)
      upsertSubagent(tabId, {
        subagentId: detail.subagentId,
        status: 'cancelled',
      })
      pushToast('已请求取消子任务', 'success')
    } catch (e) {
      patchActiveTab({ error: String(e) })
      pushToast(`取消失败 · ${String(e)}`, 'error')
    }
  }, [tabId, detail])

  const onOpenTab = useCallback(async () => {
    if (!detail?.childSessionId || opening) return
    setOpening(true)
    try {
      const id = await openSubagentTab(detail.childSessionId, {
        title: detail.description || detail.subagentType,
      })
      if (!id) {
        pushToast('打开子会话失败', 'error')
        return
      }
      setDetailId(null)
      pushToast('已在新标签打开子会话', 'success')
    } catch (e) {
      pushToast(`打开失败 · ${String(e)}`, 'error')
    } finally {
      setOpening(false)
    }
  }, [detail, opening])

  const clearFinished = useCallback(() => {
    if (!tabId) return
    const remaining = list.filter((s) => s.status === 'running')
    patchTab(tabId, { subagents: remaining })
    if (detail && detail.status !== 'running') {
      setDetailId(null)
      setLines([])
    }
    pushToast(
      remaining.length === 0
        ? '已清空子任务条'
        : `已清除 ${list.length - remaining.length} 个结束任务`,
      'info',
    )
  }, [tabId, list, detail])

  if (!sorted.length) return null

  const running = sorted.filter((s) => s.status === 'running')
  const done = sorted.filter((s) => s.status !== 'running').slice(0, 12)
  const shown = [...running, ...done]
  const hiddenDone = Math.max(0, finishedCount - done.length)

  return (
    <>
      <div className="subagent-strip" role="region" aria-label="子任务">
        <div className="subagent-strip-inner">
          <span className="subagent-strip-label">子任务</span>
          {shown.map((s) => (
            <SubagentChip
              key={s.subagentId}
              item={s}
              selected={detailId === s.subagentId}
              onSelect={() => openDetail(s)}
            />
          ))}
          {hiddenDone > 0 ? (
            <span className="subagent-strip-more">+{hiddenDone}</span>
          ) : null}
          {finishedCount > 0 ? (
            <button
              type="button"
              className="subagent-strip-clear"
              onClick={clearFinished}
              title="清除已结束的子任务芯片"
            >
              清除结束
            </button>
          ) : null}
        </div>
      </div>

      {detail ? (
        <div className="subagent-detail-dock" role="dialog" aria-label="子任务详情">
          <div className="subagent-detail-card">
            <div className="subagent-detail-head">
              <div className="subagent-detail-titles">
                <span className="subagent-detail-type">
                  {detail.subagentType || 'subagent'}
                </span>
                <span className="subagent-detail-desc">
                  {detail.description || detail.subagentId}
                </span>
              </div>
              <span className={`subagent-detail-status status-${detail.status}`}>
                {statusLabel(detail.status)}
              </span>
              <button
                type="button"
                className="subagent-detail-close"
                onClick={() => {
                  setDetailId(null)
                  setLines([])
                }}
                title="关闭"
                aria-label="关闭详情"
              >
                ×
              </button>
            </div>

            <div className="subagent-detail-meta">
              {detail.childSessionId ? (
                <span title={detail.childSessionId}>
                  会话 {detail.childSessionId.slice(0, 8)}…
                </span>
              ) : null}
              {detail.model ? <span>模型 {detail.model}</span> : null}
              {typeof detail.turnCount === 'number' ? (
                <span>{detail.turnCount} 轮</span>
              ) : null}
              {typeof detail.toolCallCount === 'number' ? (
                <span>{detail.toolCallCount} 工具</span>
              ) : null}
              {detail.durationMs ? (
                <span>{formatDuration(detail.durationMs)}</span>
              ) : null}
              {typeof detail.tokensUsed === 'number' && detail.tokensUsed > 0 ? (
                <span>{detail.tokensUsed} tok</span>
              ) : null}
            </div>

            {detail.error ? (
              <div className="subagent-detail-error">{detail.error}</div>
            ) : null}

            {detail.output ? (
              <pre className="subagent-detail-output">{detail.output}</pre>
            ) : null}

            {lines.length > 0 ? (
              <div className="subagent-detail-transcript">
                {lines.map((l) => (
                  <div key={l.id} className={`subagent-line role-${l.role}`}>
                    <span className="subagent-line-role">{roleLabel(l.role)}</span>
                    <span className="subagent-line-text">{l.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="subagent-detail-empty">暂无投影消息</div>
            )}

            <div className="subagent-detail-actions">
              <button
                type="button"
                className="subagent-btn"
                disabled={refreshing}
                onClick={() => void onRefresh()}
              >
                {refreshing ? '刷新中…' : '刷新状态'}
              </button>
              {detail.childSessionId ? (
                <button
                  type="button"
                  className="subagent-btn primary"
                  disabled={opening}
                  onClick={() => void onOpenTab()}
                  title="在新标签打开子会话"
                >
                  {opening ? '打开中…' : '新标签打开 ↗'}
                </button>
              ) : null}
              {detail.status === 'running' ? (
                <button
                  type="button"
                  className="subagent-btn danger"
                  onClick={() => void onCancel()}
                >
                  取消
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
})
