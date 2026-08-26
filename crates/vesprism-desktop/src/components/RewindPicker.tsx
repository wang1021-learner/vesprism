/**
 * 会话回滚（Rewind）选点弹层：列出可撤销历史点，选择目标后执行回滚。
 * 语义：回滚到某条 prompt 之前（对话 + 文件快照恢复），非 git 回滚。
 * 后端命令 get_rewind_points / execute_rewind 早已就绪，此处补前端 UI。
 */
import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $rewindOpen,
  $rewindTabId,
  closeRewind,
  getTabState,
  patchTab,
  pushToast,
} from '../store'
import {
  executeRewind,
  getRewindPoints,
  loadSession,
  type RewindMode,
  type RewindPointInfo,
} from '../bridge'
import { beginAttachRuntime, finishAttachRuntime } from '../lib/sessionOpen'
import { formatEngineError } from '../lib/errorMessage'

const MODE_OPTIONS: { value: RewindMode; label: string; hint: string }[] = [
  { value: 'conversation_only', label: '仅对话', hint: '只改聊天记录，不改工作区文件' },
  { value: 'all', label: '全部回滚', hint: '聊天和工作区文件一起恢复' },
  { value: 'files_only', label: '仅文件', hint: '只恢复文件，聊天留下' },
]

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RewindPicker() {
  const open = useStore($rewindOpen)
  const tabId = useStore($rewindTabId)
  const [points, setPoints] = useState<RewindPointInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [target, setTarget] = useState<RewindPointInfo | null>(null)
  const [mode, setMode] = useState<RewindMode>('conversation_only')
  const [force, setForce] = useState(false)
  const [confirmFiles, setConfirmFiles] = useState(false)
  const [running, setRunning] = useState(false)
  const touchesFiles = mode === 'all' || mode === 'files_only'

  useEffect(() => {
    if (!open) {
      setPoints([])
      setTarget(null)
      setError('')
      setConfirmFiles(false)
      setMode('conversation_only')
      setLoading(true)
      return
    }
    if (!tabId) {
      setLoading(false)
      setError('没有可回滚的会话')
      return
    }
    let cancelled = false
    setTarget(null)
    setError('')
    setLoading(true)
    getRewindPoints(tabId)
      .then((pts) => {
        if (!cancelled) setPoints(Array.isArray(pts) ? pts : [])
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(formatEngineError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tabId])

  if (!open) return null

  async function doRewind(pt: RewindPointInfo) {
    setRunning(true)
    setError('')
    try {
      // force=false 只是预演，success 恒为 false。对话回滚直接执行；
      // 改文件时若未勾强制，先预演看冲突，没有冲突再真正执行。
      const commit = !touchesFiles || force
      if (!commit) {
        const preview = await executeRewind(tabId, pt.prompt_index, mode, false)
        if (preview.conflicts?.length) {
          setError(
            `有 ${preview.conflicts.length} 处文件对不上，勾选「强制回滚」后再执行`,
          )
          return
        }
      }
      const resp = await executeRewind(tabId, pt.prompt_index, mode, true)
      if (!resp.success) {
        if (resp.conflicts?.length) {
          setError(
            `有 ${resp.conflicts.length} 处文件对不上，勾选「强制回滚」后再执行`,
          )
        } else {
          setError(formatEngineError(resp.error || '回滚失败'))
        }
        return
      }
      closeRewind()
      pushToast(
        resp.reverted_files?.length
          ? `已回滚到第 ${pt.prompt_index + 1} 条提问之前（恢复 ${resp.reverted_files.length} 个文件）`
          : `已回滚到第 ${pt.prompt_index + 1} 条提问之前`,
        'success'
      )
      // 重放会话，让 UI 与回滚后的引擎状态一致
      const st = getTabState(tabId)
      const sid = st?.sessionId || ''
      const cwd = st?.cwd || ''
      if (sid && cwd) {
        beginAttachRuntime(tabId)
        try {
          // conversation_only 回滚后不恢复代码快照（官方 --restore-code 语义：
          // 对话回滚但工作区改动保留）
          await loadSession(
            tabId,
            sid,
            cwd,
            mode === 'conversation_only' ? false : undefined,
            getTabState(tabId)?.reasoningEffort,
          )
        } finally {
          finishAttachRuntime(tabId)
        }
        patchTab(tabId, { phase: 'ready', status: 'idle', error: '' })
      }
    } catch (e) {
      setError(formatEngineError(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      className="modal-backdrop rewind-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRewind()
      }}
    >
      <div className="modal-card rewind-card" role="dialog" aria-label="回滚会话">
        <div className="rewind-head">
          <h3>回滚会话</h3>
          <button
            type="button"
            className="rewind-close"
            aria-label="关闭"
            onClick={closeRewind}
          >
            ✕
          </button>
        </div>
        <p className="rewind-desc">
          回到某条提问之前。默认只改对话；要动文件需再确认一次。
        </p>

        {loading && <div className="rewind-loading">加载历史点...</div>}
        {error && <div className="rewind-error">{error}</div>}
        {!loading && !error && points.length === 0 && (
          <div className="rewind-empty">暂无可回滚的历史点</div>
        )}

        {!loading && !error && points.length > 0 && (
          <>
            <ul className="rewind-list">
              {points.map((pt) => (
                <li key={pt.prompt_index}>
                  <button
                    type="button"
                    className={`rewind-item${target?.prompt_index === pt.prompt_index ? ' is-selected' : ''}`}
                    onClick={() => {
                      setTarget(pt)
                      setError('')
                    }}
                  >
                    <span className="rewind-item-preview">
                      {pt.prompt_preview?.trim() || `第 ${pt.prompt_index + 1} 条提问`}
                    </span>
                    <span className="rewind-item-meta">
                      <span>{formatTime(pt.created_at)}</span>
                      {pt.has_file_changes ? (
                        <span className="rewind-snap-badge">
                          {pt.num_file_snapshots} 个文件快照
                        </span>
                      ) : (
                        <span className="rewind-snap-badge is-conv">仅对话</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {target && (
              <div className="rewind-confirm">
                <div className="rewind-modes">
                  {MODE_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={`rewind-mode-btn${mode === m.value ? ' is-active' : ''}`}
                      title={m.hint}
                      onClick={() => {
                        setMode(m.value)
                        if (m.value === 'conversation_only') setConfirmFiles(false)
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {touchesFiles ? (
                  <>
                    <label className="rewind-force">
                      <input
                        type="checkbox"
                        checked={confirmFiles}
                        onChange={(e) => setConfirmFiles(e.target.checked)}
                      />
                      确认会改工作区文件
                    </label>
                    <label className="rewind-force">
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                      />
                      强制回滚（文件对不上也改）
                    </label>
                  </>
                ) : (
                  <p className="rewind-desc">只改对话，不碰工作区文件。</p>
                )}
                <div className="rewind-confirm-row">
                  <button
                    type="button"
                    className="rewind-cancel"
                    onClick={() => setTarget(null)}
                  >
                    取消选择
                  </button>
                  <button
                    type="button"
                    className="rewind-run"
                    disabled={running || (touchesFiles && !confirmFiles)}
                    onClick={() => void doRewind(target)}
                  >
                    {running ? '回滚中...' : '执行回滚'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
