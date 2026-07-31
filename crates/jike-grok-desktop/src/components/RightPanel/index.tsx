import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import {
  $rightPanelOpen,
  $rightPanelTab,
  $rightPanelWidth,
  $rightPanelOutput,
  $workspaceCwd,
  type RightPanelTab,
} from '../../store'
import { listDir, readFileText } from '../../bridge'

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
            <span className="tree-icon">{e.is_dir ? '📁' : '📄'}</span>
            <span className="tree-name">{e.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OutputView() {
  const text = useStore($rightPanelOutput)
  if (!text) return <div className="right-panel-empty">点击文件查看内容</div>
  return <pre className="right-panel-output">{text}</pre>
}

// ── 主容器：开关动画 + 正确拉伸 ──
export function RightPanel() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  const tab = useStore($rightPanelTab)
  const [mounted, setMounted] = useState(open)
  const [entered, setEntered] = useState(open)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (open) {
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
          {tab === 'files' ? <FileTree /> : <OutputView />}
        </div>
      </aside>
    </div>
  )
}
