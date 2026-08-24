/**
 * 本会话改动审阅：官方 hunk-tracker 接受/拒绝。
 * 打回会改磁盘上的文件；不是 git 暂存。
 */
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $activeTabId, $gitHeadRevision, $sessionCaps, $sessionPhase, $workspaceCwd, pushToast } from '../store'
import { hunkCall } from '../bridge'
import { DiffLines } from './Chat/DiffLines'
import {
  hunkActionOk,
  parseHunkFiles,
  parseHunks,
  relPath,
  type HunkFileRow,
  type HunkRow,
} from '../lib/hunkRows'

export function HunkReview() {
  const tabId = useStore($activeTabId)
  const cwd = useStore($workspaceCwd)
  const ready = useStore($sessionPhase) === 'ready'
  const caps = useStore($sessionCaps)
  const gitRev = useStore($gitHeadRevision)
  const [files, setFiles] = useState<HunkFileRow[]>([])
  const [hunks, setHunks] = useState<Record<string, HunkRow[]>>({})
  const [openPath, setOpenPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!tabId || !ready) return
    setLoading(true)
    setError('')
    try {
      const raw = await hunkCall(tabId, 'get-files', {})
      setFiles(parseHunkFiles(raw))
    } catch (e) {
      setError(String(e))
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [tabId, ready])

  useEffect(() => {
    void load()
  }, [load, gitRev])

  const loadHunks = async (path: string) => {
    if (!tabId || hunks[path]) return
    try {
      const raw = await hunkCall(tabId, 'get-hunks', {
        path,
        source: 'all',
      })
      setHunks((prev) => ({ ...prev, [path]: parseHunks(raw) }))
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const act = async (
    method: string,
    params: Record<string, unknown>,
    key: string,
    label: string,
  ) => {
    if (!tabId || busy) return
    if (confirm !== key) {
      setConfirm(key)
      return
    }
    setBusy(key)
    try {
      const raw = await hunkCall(tabId, method, params)
      const r = hunkActionOk(raw)
      if (!r.ok) {
        pushToast(r.error, 'error')
        return
      }
      pushToast(r.affected ? `${label} ${r.affected} 处` : label, 'success')
      setConfirm('')
      setHunks({})
      await load()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  if (!ready) {
    return <p className="right-panel-empty">会话未就绪。</p>
  }
  if (!caps.hunks) {
    return <p className="right-panel-empty">当前会话后端不支持改动审阅。</p>
  }

  return (
    <div className="hunk-review">
      <div className="right-panel-output-head right-panel-diff-head">
        <span className="output-file-name">本会话改动</span>
        {files.length > 0 ? (
          <span className="diff-status-badge diff-status-modified">{files.length}</span>
        ) : null}
        <button
          type="button"
          className="diff-refresh-btn"
          disabled={loading || Boolean(busy)}
          onClick={() => {
            setHunks({})
            void load()
          }}
        >
          刷新
        </button>
        {files.length > 0 ? (
          <>
            <button
              type="button"
              className="diff-refresh-btn"
              disabled={Boolean(busy)}
              onClick={() =>
                void act('all-action', { action: 'accept' }, 'all-a', '已接受')
              }
            >
              {confirm === 'all-a' ? '再点确认全部接受' : '全部接受'}
            </button>
            <button
              type="button"
              className="diff-refresh-btn"
              disabled={Boolean(busy)}
              onClick={() =>
                void act('all-action', { action: 'reject' }, 'all-r', '已打回')
              }
            >
              {confirm === 'all-r' ? '再点确认全部打回' : '全部打回'}
            </button>
          </>
        ) : null}
      </div>
      <p className="hunk-review-hint">
        接受留下模型写的内容；打回还原到改之前。这不是 git 暂存。
      </p>
      {error ? <div className="tree-error">{error}</div> : null}
      {loading && files.length === 0 ? <div className="tree-loading">加载改动…</div> : null}
      {!loading && files.length === 0 && !error ? (
        <div className="right-panel-empty">本会话还没有可审阅的改动。</div>
      ) : null}
      <ul className="workspace-changes">
        {files.map((f) => {
          const open = openPath === f.path
          const list = hunks[f.path] || []
          return (
            <li key={f.path} className={`workspace-change${open ? ' is-open' : ''}`}>
              <button
                type="button"
                className="workspace-change-head"
                onClick={() => {
                  if (open) {
                    setOpenPath('')
                    return
                  }
                  setOpenPath(f.path)
                  void loadHunks(f.path)
                }}
              >
                <span className={`diff-status-badge ${f.isAgentFile ? 'diff-status-modified' : 'diff-status-untracked'}`}>
                  {f.isAgentFile ? '模型' : '外部'}
                </span>
                <span className="workspace-change-path" title={f.path}>
                  {relPath(f.path, cwd)}
                </span>
                <span className="workspace-change-stat">
                  +{f.additions} −{f.deletions}
                </span>
              </button>
              {open ? (
                <div className="hunk-file-body">
                  <div className="hunk-file-actions">
                    <button
                      type="button"
                      className="insight-btn"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act(
                          'file-action',
                          { path: f.path, action: 'accept' },
                          `f-a:${f.path}`,
                          '已接受此文件',
                        )
                      }
                    >
                      {confirm === `f-a:${f.path}` ? '再点确认接受' : '接受此文件'}
                    </button>
                    <button
                      type="button"
                      className="insight-btn"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act(
                          'file-action',
                          { path: f.path, action: 'reject' },
                          `f-r:${f.path}`,
                          '已打回此文件',
                        )
                      }
                    >
                      {confirm === `f-r:${f.path}` ? '再点确认打回' : '打回此文件'}
                    </button>
                  </div>
                  {list.length === 0 ? (
                    <p className="work-empty">加载块…</p>
                  ) : (
                    list.map((h) => (
                      <div key={h.id} className="hunk-block">
                        <div className="hunk-block-head">
                          <span>
                            {h.source === 'agent' ? '模型' : '外部'}
                            {h.promptIndex != null ? ` · 第 ${h.promptIndex} 轮` : ''}
                          </span>
                          <span>
                            <button
                              type="button"
                              className="insight-btn"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void act(
                                  'hunk-action',
                                  { hunkId: h.id, action: 'accept' },
                                  `h-a:${h.id}`,
                                  '已接受',
                                )
                              }
                            >
                              {confirm === `h-a:${h.id}` ? '再点确认' : '接受'}
                            </button>
                            <button
                              type="button"
                              className="insight-btn"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void act(
                                  'hunk-action',
                                  { hunkId: h.id, action: 'reject' },
                                  `h-r:${h.id}`,
                                  '已打回',
                                )
                              }
                            >
                              {confirm === `h-r:${h.id}` ? '再点确认' : '打回'}
                            </button>
                          </span>
                        </div>
                        <DiffLines oldText={h.oldText} newText={h.newText} />
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
