import type { SessionStatus } from '../../types'

interface HeaderProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  status: SessionStatus
  ready: boolean
  starting: boolean
  /** 当前对话标题（一般为用户第一句提问） */
  chatTitle: string
  onStartSession: () => void
  onRestartSession: () => void
}

function statusLabel(s: SessionStatus): string {
  switch (s) {
    case 'initializing':
      return '初始化中…'
    case 'idle':
      return '就绪'
    case 'generating':
      return '生成中…'
    case 'ended':
      return '已结束'
    default:
      return '未知'
  }
}

export function Header({
  sidebarCollapsed,
  onToggleSidebar,
  status,
  ready,
  starting,
  chatTitle,
  onStartSession,
  onRestartSession,
}: HeaderProps) {
  const title = chatTitle.trim() || '新对话'

  return (
    <header className="main-header">
      <div className="header-left">
        {sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-toggle-btn"
            title="展开边栏"
            onClick={onToggleSidebar}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        )}

        {/* 当前对话标题：用户第一句提问；过长省略 */}
        <h1 className="chat-title" title={title}>
          {title}
        </h1>
      </div>

      <div className="header-right">
        <div className="status-indicator">
          <span className={`dot status-${status}`} />
          <span className="status-text">{statusLabel(status)}</span>
        </div>

        {!ready ? (
          <button
            type="button"
            className="header-btn"
            disabled={starting}
            onClick={onStartSession}
          >
            {starting ? '启动中…' : '启动会话'}
          </button>
        ) : (
          <button
            type="button"
            className="header-btn"
            disabled={starting}
            onClick={onRestartSession}
          >
            {starting ? '重启中…' : '新会话'}
          </button>
        )}
      </div>
    </header>
  )
}
