/**
 * 跨会话记忆：官方 /memory 清单 + flush / dream / remember。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $memoryFiles,
  $sessionPhase,
  $workspaceCwd,
  pushToast,
} from '../store'
import { deleteMemoryPath, readMemoryFile, sessionExt } from '../bridge'
import { sendEngineSlash } from '../lib/engineSlash'
import { memoryRowTitle, workspaceFolderName } from '../lib/memoryRows'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function MemoryPanel() {
  const tabId = useStore($activeTabId)
  const files = useStore($memoryFiles)
  const ready = useStore($sessionPhase) === 'ready'
  const cwd = useStore($workspaceCwd)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [confirmDel, setConfirmDel] = useState('')

  const refresh = useCallback(() => {
    if (!ready) return
    void sendEngineSlash('/memory')
  }, [ready])

  useEffect(() => {
    refresh()
  }, [refresh, cwd])

  useEffect(() => {
    if (!sel && files[0]?.path) setSel(files[0].path)
  }, [files, sel])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (!q) return true
      const meta = memoryRowTitle(f.path, f.source, cwd)
      return (
        f.path.toLowerCase().includes(q) ||
        meta.title.toLowerCase().includes(q) ||
        meta.chip.includes(q) ||
        meta.hint.includes(q)
      )
    })
  }, [files, query])

  useEffect(() => {
    if (!sel) {
      setBody('')
      return
    }
    let alive = true
    readMemoryFile(sel)
      .then((t) => {
        if (alive) setBody(t || '（空文件）')
      })
      .catch((e) => {
        if (alive) setBody(String(e))
      })
    return () => {
      alive = false
    }
  }, [sel])

  const run = async (kind: 'flush' | 'dream' | 'remember') => {
    if (!tabId || busy) return
    setBusy(kind)
    try {
      if (kind === 'flush') {
        await sessionExt(tabId, 'x.ai/memory/flush', {})
        pushToast('正在把本会话写入记忆', 'success')
      } else if (kind === 'dream') {
        await sendEngineSlash('/dream')
        pushToast('正在整理记忆', 'success')
      } else {
        const text = note.trim()
        if (!text) {
          pushToast('先写一句要记住的话', 'info')
          return
        }
        const rewritten = await sessionExt(tabId, 'x.ai/memory/rewrite', {
          rawText: text,
          contextSummary: cwd || '',
        })
        const out =
          (typeof rewritten?.text === 'string' && rewritten.text) ||
          (typeof rewritten?.markdown === 'string' && rewritten.markdown) ||
          text
        await sendEngineSlash(`/remember ${out}`)
        setNote('')
        pushToast('已记下', 'success')
      }
      refresh()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="work-panel" role="region" aria-label="记忆">
      <div className="work-panel-inner">
        <header className="work-panel-head">
          <div>
            <h2 className="work-panel-title">记忆</h2>
            <p className="work-panel-desc">
              {cwd
                ? `当前仓库「${workspaceFolderName(cwd)}」。全局所有项目共用；本仓库只给这个目录。`
                : '跨会话记住约定和结论。'}
              删掉聊天或从侧栏移出项目，记忆文件还在。磁盘上删了仓库代码，记忆也不会自动消失。
            </p>
          </div>
          <div className="work-panel-actions">
            <button type="button" className="skills-btn" onClick={refresh} disabled={!ready}>
              刷新
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={!ready || Boolean(busy)}
              onClick={() => void run('flush')}
            >
              {busy === 'flush' ? '写入中…' : '立刻写入'}
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={!ready || Boolean(busy)}
              onClick={() => void run('dream')}
            >
              {busy === 'dream' ? '整理中…' : '整理'}
            </button>
          </div>
        </header>

        <div className="work-split">
          <div className="work-list">
            <input
              className="work-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索文件名"
            />
            {rows.length === 0 ? (
              <p className="work-empty">
                {ready ? '还没有记忆文件。写一句要点再点「记一条」，或先「立刻写入」。' : '会话未就绪。'}
              </p>
            ) : (
              <ul className="work-rows">
                {rows.map((f) => {
                  const meta = memoryRowTitle(f.path, f.source, cwd)
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        className={`work-row${sel === f.path ? ' is-on' : ''}`}
                        title={f.path}
                        onClick={() => {
                          setSel(f.path)
                          setConfirmDel('')
                        }}
                      >
                        <span className="work-chip">{meta.chip}</span>
                        <span>
                          <span className="work-row-title">{meta.title}</span>
                          <div className="work-row-sub">
                            {meta.hint} · {fmtSize(f.sizeBytes)}
                          </div>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="work-preview">
            {sel ? (
              <>
                <div className="work-row-sub" style={{ marginBottom: 10 }} title={sel}>
                  {sel}
                  <button
                    type="button"
                    className="skills-btn"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      void navigator.clipboard.writeText(sel)
                      pushToast('已复制路径', 'success')
                    }}
                  >
                    复制路径
                  </button>
                  {(() => {
                    const f = files.find((x) => x.path === sel)
                    if (!f || f.source === 'global') return null
                    const workspaceWipe = f.source === 'workspace'
                    const asking = confirmDel === sel
                    return (
                      <button
                        type="button"
                        className="skills-btn"
                        style={{ marginLeft: 8 }}
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (!asking) {
                            setConfirmDel(sel)
                            return
                          }
                          setBusy('del')
                          void deleteMemoryPath(sel, f.source)
                            .then(() => {
                              pushToast(
                                workspaceWipe ? '已删除这份仓库记忆' : '已删除会话日志',
                                'success',
                              )
                              setSel('')
                              setBody('')
                              setConfirmDel('')
                              refresh()
                            })
                            .catch((e) => pushToast(String(e), 'error'))
                            .finally(() => setBusy(''))
                        }}
                      >
                        {asking
                          ? workspaceWipe
                            ? '再点一次：删掉本仓库记忆和会话日志'
                            : '再点一次确认删除'
                          : workspaceWipe
                            ? '删除本仓库记忆'
                            : '删除这条日志'}
                      </button>
                    )
                  })()}
                </div>
                <pre>{body || '读取中…'}</pre>
              </>
            ) : (
              <p className="work-empty">选左侧文件查看正文。</p>
            )}
          </div>
        </div>

        <label className="insight-note" style={{ marginTop: 14 }}>
          <span>
            记一条
            {cwd ? `（写入「${workspaceFolderName(cwd)}」的本仓库记忆）` : ''}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：发版前必须跑 e2e"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run('remember')
            }}
            disabled={!ready}
          />
        </label>
        <div className="insight-actions">
          <button
            type="button"
            className="insight-btn is-primary"
            disabled={!ready || Boolean(busy)}
            onClick={() => void run('remember')}
          >
            记一条
          </button>
        </div>
      </div>
    </div>
  )
}
