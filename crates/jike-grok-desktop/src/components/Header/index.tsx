interface HeaderProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** 当前对话标题（一般为用户第一句提问） */
  chatTitle: string
}

export function Header({
  sidebarCollapsed,
  onToggleSidebar,
  chatTitle,
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

        {/* 当前对话标题；用户只感知「对话」，不暴露「启动会话」 */}
        <h1 className="chat-title" title={title}>
          {title}
        </h1>
      </div>
    </header>
  )
}
