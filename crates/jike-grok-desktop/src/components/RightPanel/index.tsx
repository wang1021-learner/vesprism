import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import {
  $rightPanelOpen,
  $rightPanelTab,
  $rightPanelWidth,
  $rightPanelFile,
  $rightPanelFilePath,
  $rightPanelOutput,
  $sidebarCollapsed,
  $sidebarAutoCollapsed,
  $workspaceCwd,
  $gitHeadRevision,
  type RightPanelTab,
} from '../../store'
import { listDir, readFileText, workspaceChanges, type WorkspaceChange } from '../../bridge'
import { DiffLines } from '../Chat/DiffLines'

const MIN_W = 260
const MAX_RATIO = 0.55
const OPEN_MS = 240

// ── 拖拽手柄：按下时锁定基准宽度，避免位移重复累加 ──
function ResizeHandle() {
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = $rightPanelWidth.get()

    const onMove = (ev: MouseEvent) => {
      // 手柄在左侧：向左拖 → 变宽
      const next = startW + (startX - ev.clientX)
      const maxW = Math.floor(window.innerWidth * MAX_RATIO)
      $rightPanelWidth.set(Math.max(MIN_W, Math.min(maxW, next)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div
      className="right-panel-resize-handle"
      onMouseDown={onDown}
      title="拖动调整宽度"
      role="separator"
      aria-orientation="vertical"
    />
  )
}

// ── Tab 栏（中文） ──
const TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'files', label: '文件' },
  { id: 'output', label: '源码' },
  { id: 'diff', label: '差异' },
]

function TabBar() {
  const tab = useStore($rightPanelTab)
  return (
    <div className="right-panel-tabs">
      <div className="right-panel-tab-group" role="tablist" aria-label="右侧面板">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`right-panel-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => $rightPanelTab.set(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="right-panel-close"
        onClick={() => $rightPanelOpen.set(false)}
        title="关闭面板"
        aria-label="关闭面板"
      >
        ×
      </button>
    </div>
  )
}

// ── 文件树 ──
interface DirEntry {
  name: string
  is_dir: boolean
}

function FileTree() {
  const cwd = useStore($workspaceCwd)
  const [path, setPath] = useState(cwd)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setPath(cwd)
  }, [cwd])

  useEffect(() => {
    if (!path) return
    setLoading(true)
    setError('')
    listDir(path)
      .then(setEntries)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [path])

  const enterDir = (name: string) => {
    setPath((p) => p.replace(/[/\\]$/, '') + '/' + name)
  }
  const goUp = () => {
    const p = path.replace(/[/\\]$/, '')
    const parent = p.split(/[/\\]/).slice(0, -1).join('/') || '/'
    setPath(parent)
  }
  const openFile = async (name: string) => {
    const fp = path.replace(/[/\\]$/, '') + '/' + name
    try {
      const text = await readFileText(fp)
      $rightPanelOutput.set(text)
      $rightPanelFile.set(name)
      $rightPanelFilePath.set(fp)
      $rightPanelTab.set('output')
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="right-panel-tree">
      <div className="tree-breadcrumb">
        <button type="button" onClick={goUp} title="上一级">
          ..
        </button>
        <span className="tree-path">{path}</span>
      </div>
      {loading && <div className="tree-loading">加载中...</div>}
      {error && <div className="tree-error">{error}</div>}
      <div className="tree-entries">
        {entries.map((e) => (
          <div
            key={e.name}
            className={`tree-entry ${e.is_dir ? 'is-dir' : 'is-file'}`}
            onClick={() => (e.is_dir ? enterDir(e.name) : openFile(e.name))}
          >
            {e.is_dir ? (
              <svg className="tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            ) : (
              <svg className="tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
            )}
            <span className="tree-name">{e.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OutputView() {
  const text = useStore($rightPanelOutput)
  const fileName = useStore($rightPanelFile)
  if (!text) return <div className="right-panel-empty">点击文件查看内容</div>
  return (
    <div className="right-panel-output-wrap">
      <div className="right-panel-output-head">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="output-file-name">{fileName}</span>
      </div>
      <pre className="right-panel-output">{text}</pre>
    </div>
  )
}

const CHANGE_STATUS_LABEL: Record<string, string> = {
  modified: '已修改',
  untracked: '未跟踪',
  deleted: '已删除',
  renamed: '重命名',
}

const CHANGE_STATUS_BADGE: Record<string, string> = {
  modified: 'diff-status-modified',
  untracked: 'diff-status-untracked',
  deleted: 'diff-status-deleted',
  renamed: 'diff-status-renamed',
}

/** 工作区改动总览：列出全部未提交文件，点开看该文件 diff（不再绑定打开的文件） */
function DiffView() {
  const cwd = useStore($workspaceCwd)
  // git_head_changed 事件驱动自动刷新（分支切换 / 提交后）
  const gitRev = useStore($gitHeadRevision)
  const [changes, setChanges] = useState<WorkspaceChange[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [openPath, setOpenPath] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    workspaceChanges()
      .then((res) => {
        if (!cancelled) setChanges(res)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setChanges([])
          setError(String(e))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, tick, gitRev])

  return (
    <div className="right-panel-diff-wrap">
      <div className="right-panel-output-head right-panel-diff-head">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          <path d="M9 12h6" />
        </svg>
        <span className="output-file-name">工作区改动</span>
        {!loading && changes.length > 0 && (
          <span className="diff-status-badge diff-status-modified">{changes.length}</span>
        )}
        <button
          type="button"
          className="diff-refresh-btn"
          onClick={() => {
            setTick((n) => n + 1)
            setOpenPath('')
          }}
          disabled={loading}
          title="刷新改动"
          aria-label="刷新改动"
        >
          刷新
        </button>
      </div>
      {loading && <div className="tree-loading">对比中...</div>}
      {error && <div className="tree-error">{error}</div>}
      {!loading && !error && changes.length === 0 && (
        <div className="right-panel-empty">与 HEAD 一致，无未提交改动</div>
      )}
      {!loading && !error && changes.length > 0 && (
        <ul className="workspace-changes">
          {changes.map((ch) => {
            const open = openPath === ch.path
            const hasBody = ch.old_text.length > 0 || ch.new_text.length > 0
            return (
              <li key={ch.path} className={`workspace-change${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="workspace-change-head"
                  onClick={() => setOpenPath(open ? '' : ch.path)}
                  title={hasBody ? (open ? '收起' : '展开 diff') : '无内容可展示'}
                >
                  <span className={`diff-status-badge ${CHANGE_STATUS_BADGE[ch.status] ?? 'diff-status-modified'}`}>
                    {CHANGE_STATUS_LABEL[ch.status] ?? ch.status}
                  </span>
                  <span className="workspace-change-path" title={ch.path}>
                    {ch.path}
                  </span>
                  {hasBody && (
                    <span className={`scaffold-caret${open ? ' is-open' : ''}`} aria-hidden>
                      ›
                    </span>
                  )}
                </button>
                {open && hasBody && (
                  <div className="right-panel-diff-body">
                    <DiffLines oldText={ch.old_text} newText={ch.new_text} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function PanelBody() {
  const tab = useStore($rightPanelTab)
  if (tab === 'files') return <FileTree />
  if (tab === 'diff') return <DiffView />
  return <OutputView />
}

// ── 主容器：开关动画 + 正确拉伸 ──
export function RightPanel() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  const [mounted, setMounted] = useState(open)
  const [entered, setEntered] = useState(open)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (open) {
      if (!$sidebarCollapsed.get()) {
        $sidebarCollapsed.set(true)
        $sidebarAutoCollapsed.set(true)
      }
      setMounted(true)
      setAnimating(true)
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntered(true))
      })
      const t = window.setTimeout(() => setAnimating(false), OPEN_MS)
      return () => {
        cancelAnimationFrame(id)
        window.clearTimeout(t)
      }
    }
    if ($sidebarAutoCollapsed.get()) {
      $sidebarCollapsed.set(false)
      $sidebarAutoCollapsed.set(false)
    }
    setAnimating(true)
    setEntered(false)
    const t = window.setTimeout(() => {
      setMounted(false)
      setAnimating(false)
    }, OPEN_MS)
    return () => window.clearTimeout(t)
  }, [open])

  if (!mounted) return null

  return (
    <div
      className={[
        'right-panel-shell',
        entered ? 'is-open' : '',
        animating ? 'is-animating' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        width: entered ? width : 0,
        ['--rp-width' as string]: `${width}px`,
      }}
    >
      <ResizeHandle />
      <aside className="right-panel">
        <TabBar />
        <div className="right-panel-body">
          <PanelBody />
        </div>
      </aside>
    </div>
  )
}
