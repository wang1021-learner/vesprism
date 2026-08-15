import { lazy, Suspense, useCallback } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $backgroundTasks,
  $ptyAlive,
  $ptyEpoch,
  $sessionDockKind,
  $sessionDockWidth,
  $subagents,
  $workspaceCwd,
  $workflows,
  getTabState,
  removeBackgroundTask,
  toggleSessionDock,
  type SessionDockKind,
} from '../store'
import { killTask } from '../bridge'
import { isWorkflowLive } from '../lib/workflowCards'
import { SubagentRunTree } from './SubagentRunTree'

const TerminalPane = lazy(() =>
  import('./TerminalPane').then((m) => ({ default: m.TerminalPane })),
)

const PANELS: { kind: SessionDockKind; label: string }[] = [
  { kind: 'subagents', label: '子代理' },
  { kind: 'terminal', label: '终端' },
  { kind: 'bgTasks', label: '后台任务' },
]

const MIN_W = 220
const MAX_RATIO = 0.7

function DockResizeHandle() {
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = $sessionDockWidth.get()
    const onMove = (ev: MouseEvent) => {
      const next = startW + (startX - ev.clientX)
      const maxW = Math.floor(window.innerWidth * MAX_RATIO)
      $sessionDockWidth.set(Math.max(MIN_W, Math.min(maxW, next)))
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
      className="session-term-resize-handle"
      onMouseDown={onDown}
      title="拖动调整宽度"
      role="separator"
      aria-orientation="vertical"
    />
  )
}

/** 会话区右侧栏：子代理 / 终端 / 后台任务，互斥只开一块。 */
export function SessionTermDock() {
  const kind = useStore($sessionDockKind)
  const tabId = useStore($activeTabId)
  const workspaceCwd = useStore($workspaceCwd)
  const workflows = useStore($workflows)
  const subagents = useStore($subagents)
  const ptyAlive = useStore($ptyAlive)
  const ptyEpoch = useStore($ptyEpoch)
  const bgTasks = useStore($backgroundTasks)
  const cwd = (getTabState(tabId)?.cwd || workspaceCwd || '').trim()
  const epoch = tabId ? (ptyEpoch[tabId] ?? 0) : 0

  const live: Record<SessionDockKind, boolean> = {
    subagents:
      Object.values(workflows).some((w) => isWorkflowLive(w.status)) ||
      subagents.some((s) => s.status === 'running'),
    terminal: Boolean(tabId && ptyAlive[tabId]),
    bgTasks: Object.keys(bgTasks).length > 0,
  }

  const width = useStore($sessionDockWidth)
  const open = kind != null
  const title = PANELS.find((p) => p.kind === kind)?.label ?? ''

  return (
    <div className={`session-term-dock${open ? ' is-open' : ' is-closed'}`}>
      {open ? (
        <aside className="session-term-panel" aria-label={title} style={{ width }}>
          <DockResizeHandle />
          <div className="session-term-panel-head">
            <span>{title}</span>
            <button
              type="button"
              className="session-term-panel-close"
              onClick={() => $sessionDockKind.set(null)}
            >
              收起
            </button>
          </div>
          <div className="session-term-panel-body scrollbar-dt">
            {kind === 'subagents' ? <SubagentsPane /> : null}
            {kind === 'terminal' && tabId ? (
              <Suspense fallback={<div className="session-term-empty">加载终端…</div>}>
                <TerminalPane key={`${tabId}:${cwd}:${epoch}`} cwd={cwd} tabId={tabId} />
              </Suspense>
            ) : null}
            {kind === 'bgTasks' ? <BgTasksPane /> : null}
          </div>
        </aside>
      ) : null}
      <nav className="session-term-rail" aria-label="会话侧栏">
        {PANELS.map((p) => (
          <button
            key={p.kind}
            type="button"
            className={`session-term-toggle${kind === p.kind ? ' is-active' : ''}${live[p.kind] ? ' is-running' : ''}`}
            aria-expanded={kind === p.kind}
            title={kind === p.kind ? `收起${p.label}` : `打开${p.label}`}
            onClick={() => toggleSessionDock(p.kind)}
          >
            <span className="session-term-toggle-label">{p.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function SubagentsPane() {
  const workflows = useStore($workflows)
  const subagents = useStore($subagents)
  if (Object.keys(workflows).length === 0 && subagents.length === 0) {
    return <div className="session-term-empty">还没有子任务或工作流。</div>
  }
  return <SubagentRunTree />
}

function BgTasksPane() {
  const tasks = useStore($backgroundTasks)
  const tabId = useStore($activeTabId)
  const entries = Object.entries(tasks)
  if (entries.length === 0) {
    return <div className="session-term-empty">没有运行中的后台任务。这是模型扔到后台还在跑的命令，不是能打字的终端。</div>
  }
  return (
    <ul className="session-bg-list">
      {entries.map(([toolCallId, t]) => (
        <li key={toolCallId} className="session-bg-item">
          <span className="session-bg-dot" aria-hidden />
          <span className="session-bg-cmd" title={t.command}>
            {t.description || t.command || t.taskId}
          </span>
          <button
            type="button"
            className="session-term-panel-close"
            onClick={() => {
              void killTask(tabId, t.taskId)
                .then(() => removeBackgroundTask(tabId, toolCallId))
                .catch(() => {})
            }}
          >
            终止
          </button>
        </li>
      ))}
    </ul>
  )
}
