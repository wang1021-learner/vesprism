/**
 * 跨会话记忆：官方 /memory 清单 + flush / dream / remember。
 * 引擎总开关在「设置 → 引擎」；这里管本会话是否用、以及磁盘上的文件。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $memoryEnabled,
  $memoryFiles,
  $sessionCaps,
  $workspaceCwd,
  getTabState,
  patchActiveTab,
  pushToast,
  type MemoryFileInfo,
} from '../store'
import { codingSessionReady, useCodingSessionTabId } from '../lib/codingSession'
import {
  deleteMemoryPath,
  getEnginePrefs,
  listCatalogMemory,
  readMemoryFile,
  sessionMemoryFlush,
  sessionMemoryRewrite,
  sessionSetMemory,
} from '../bridge'
import { sendEngineSlash } from '../lib/engineSlash'
import {
  groupMemoryFiles,
  memoryRowTitle,
  workspaceFolderName,
} from '../lib/memoryRows'
import { SettingsHelp } from './SettingsHelp'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function MemoryPanel() {
  const tabId = useCodingSessionTabId()
  const filesLive = useStore($memoryFiles)
  const memoryOnLive = useStore($memoryEnabled)
  const caps = useStore($sessionCaps)
  const st = getTabState(tabId)
  const ready = codingSessionReady(tabId)
  const cwd = useStore($workspaceCwd)
  const memoryOn = st?.memoryEnabled ?? memoryOnLive
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [confirmDel, setConfirmDel] = useState('')
  const [diskFiles, setDiskFiles] = useState<MemoryFileInfo[]>([])
  const [engineOn, setEngineOn] = useState<boolean | null>(null)

  const files = useMemo(() => {
    const live = st?.memoryFiles?.length ? st.memoryFiles : filesLive
    if (live.length) return live
    return diskFiles
  }, [st?.memoryFiles, filesLive, diskFiles])

  const refresh = useCallback(() => {
    void getEnginePrefs()
      .then((p) => setEngineOn(p.memory_enabled))
      .catch(() => setEngineOn(null))
    void listCatalogMemory()
      .then((cat) => {
        const list = Array.isArray(cat?.files) ? cat.files : []
        setDiskFiles(
          list.map((f) => ({
            path: f.path,
            source: f.source,
            sizeBytes: f.sizeBytes,
          })),
        )
      })
      .catch(() => setDiskFiles([]))
    if (ready && tabId) void sendEngineSlash('/memory', tabId)
  }, [ready, tabId])

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

  const groups = useMemo(() => groupMemoryFiles(rows, cwd), [rows, cwd])
  const selected = files.find((x) => x.path === sel)
  const selectedMeta = selected
    ? memoryRowTitle(selected.path, selected.source, cwd)
    : null

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

  const canWrite = ready && memoryOn && engineOn !== false && caps.memory !== false

  const run = async (kind: 'flush' | 'dream' | 'remember') => {
    if (!tabId || busy || !canWrite) return
    setBusy(kind)
    try {
      if (kind === 'flush') {
        await sessionMemoryFlush(tabId)
        pushToast('正在把本对话写入记忆，完成后会再提示', 'info')
      } else if (kind === 'dream') {
        await sendEngineSlash('/dream')
        pushToast('正在压缩整理旧记忆，完成后会再提示', 'info')
      } else {
        const text = note.trim()
        if (!text) {
          pushToast('先写一句要记住的话', 'info')
          return
        }
        const rewritten = await sessionMemoryRewrite(tabId, {
          rawText: text,
          contextSummary: cwd || '',
        })
        const out =
          (typeof rewritten?.text === 'string' && rewritten.text) ||
          (typeof rewritten?.markdown === 'string' && rewritten.markdown) ||
          text
        await sendEngineSlash(`/remember ${out}`)
        setNote('')
        pushToast('已写入本仓库记忆', 'success')
      }
      refresh()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const toggleSession = () => {
    if (!tabId || busy || engineOn === false) return
    const next = !memoryOn
    patchActiveTab({ memoryEnabled: next })
    void sessionSetMemory(tabId, next)
      .then(() => {
        pushToast(
          next ? '本会话会读写记忆' : '本会话暂时不用记忆（文件还在）',
          'success',
        )
        if (next) refresh()
      })
      .catch((e) => {
        patchActiveTab({ memoryEnabled: !next })
        pushToast(String(e), 'error')
      })
  }

  let emptyHint = '还没有记忆文件。下面写一句要点再点「记下」，或先「把本对话写入记忆」。'
  if (!ready && files.length === 0) {
    emptyHint = '还没有记忆文件。先在编码里开一场对话，才能写入或开关本会话记忆。'
  } else if (query.trim() && rows.length === 0) {
    emptyHint = '没有匹配的文件。'
  } else if (engineOn === false && files.length === 0) {
    emptyHint = '跨会话记忆已关闭，磁盘上也还没有文件。到「设置 → 引擎」打开后，新会话才会写入。'
  }

  const project = workspaceFolderName(cwd)

  return (
    <div className="work-panel" role="region" aria-label="记忆">
      <div className="work-panel-inner">
        <header className="work-panel-head">
          <div>
            <h2 className="work-panel-title">记忆</h2>
            <p className="work-panel-desc">
              跨对话记住约定和结论，不是聊天记录本身。
              {project ? ` 当前仓库「${project}」。` : ' '}
              全局所有项目共用；本仓库只给这个目录。删掉聊天或移出项目，这些文件还在。
            </p>
          </div>
          <div className="work-panel-actions">
            <button
              type="button"
              className={`skills-btn${memoryOn ? ' is-on' : ''}`}
              disabled={!ready || Boolean(busy) || engineOn === false}
              title={
                engineOn === false
                  ? '先在「设置 → 引擎」打开跨会话记忆'
                  : memoryOn
                    ? '本会话正在用记忆，点此暂停'
                    : '本会话没用记忆，点此打开'
              }
              onClick={toggleSession}
            >
              {memoryOn ? '本会话使用记忆' : '本会话不用记忆'}
            </button>
            <SettingsHelp
              className="settings-help--end"
              text="只影响当前这场对话要不要读、写记忆。总开关在「设置 → 引擎」。关掉不会删文件。"
            />
            <button type="button" className="skills-btn" onClick={refresh}>
              刷新
            </button>
          </div>
        </header>

        {engineOn === false ? (
          <p className="memory-banner" role="status">
            跨会话记忆已在「设置 → 引擎」关闭。下面仍可看已有文件；写入和新对话注入要先打开总开关，并新开一场会话。
          </p>
        ) : null}
        {engineOn !== false && !ready ? (
          <p className="memory-banner" role="status">
            先在编码里开一场对话，才能写入或开关「本会话使用记忆」。磁盘上的文件仍可浏览、删除。
          </p>
        ) : null}

        <section className="memory-write" aria-label="写入记忆">
          <label className="insight-note">
            <span>
              记一条
              {project ? `（写入「${project}」的本仓库记忆）` : ''}
              <SettingsHelp text="写成一条短事实，进本仓库 MEMORY.md，之后新对话可能被检索到。不会改聊天记录。" />
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：发版前必须跑 e2e"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run('remember')
              }}
              disabled={!canWrite}
            />
          </label>
          <div className="insight-actions">
            <button
              type="button"
              className="insight-btn is-primary"
              disabled={!canWrite || Boolean(busy)}
              onClick={() => void run('remember')}
            >
              {busy === 'remember' ? '记下…' : '记下'}
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={!canWrite || Boolean(busy)}
              title="把当前这场对话的要点追加进记忆，不必等会话结束。"
              onClick={() => void run('flush')}
            >
              {busy === 'flush' ? '写入中…' : '把本对话写入记忆'}
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={!canWrite || Boolean(busy)}
              title="把零散会话日志压成更短的长期记忆，不会删掉你手写的那条。"
              onClick={() => void run('dream')}
            >
              {busy === 'dream' ? '整理中…' : '压缩整理旧记忆'}
            </button>
          </div>
        </section>

        <div className="work-split">
          <div className="work-list">
            <input
              className="work-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题或文件名"
            />
            {rows.length === 0 ? (
              <p className="work-empty">{emptyHint}</p>
            ) : (
              <ul className="work-rows">
                {groups.map((g) => (
                  <li key={g.id}>
                    <div className="work-group-label">{g.label}</div>
                    <ul>
                      {g.files.map((f) => {
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
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="work-preview">
            {sel && selected && selectedMeta ? (
              <>
                <div className="work-preview-head">
                  <div className="work-preview-head-main">
                    <span className="work-chip">{selectedMeta.chip}</span>
                    <div>
                      <div className="work-row-title">{selectedMeta.title}</div>
                      <div className="work-row-sub" title={sel}>
                        {selectedMeta.hint}
                      </div>
                    </div>
                  </div>
                  <div className="work-preview-head-actions">
                    <button
                      type="button"
                      className="skills-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(sel)
                        pushToast('已复制路径', 'success')
                      }}
                    >
                      复制路径
                    </button>
                    {selected.source === 'global' ? (
                      <span className="work-row-sub">
                        全局记忆不能整份删，请改文件内容。
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="skills-btn"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          const workspaceWipe = selected.source === 'workspace'
                          if (confirmDel !== sel) {
                            setConfirmDel(sel)
                            return
                          }
                          setBusy('del')
                          void deleteMemoryPath(sel, selected.source)
                            .then(() => {
                              pushToast(
                                workspaceWipe
                                  ? '已删除这份仓库记忆和它下面的会话日志'
                                  : '已删除这条会话日志',
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
                        {confirmDel === sel
                          ? selected.source === 'workspace'
                            ? '再点一次：删掉本仓库记忆和会话日志'
                            : '再点一次确认删除'
                          : selected.source === 'workspace'
                            ? '删除本仓库记忆'
                            : '删除这条日志'}
                      </button>
                    )}
                  </div>
                </div>
                <pre>{body || '读取中…'}</pre>
              </>
            ) : (
              <p className="work-empty">选左侧文件查看正文。这里只读，改内容请用编辑器打开复制的路径。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
