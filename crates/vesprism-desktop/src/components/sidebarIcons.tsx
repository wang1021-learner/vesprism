/** 简洁文件夹线框（不用 emoji / 系统桌面图标） */
export function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className={`sidebar-folder-icon${open ? ' open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l1.8 1.8c.2.2.5.3.8.3H19.5A1.5 1.5 0 0 1 21 9.6v8.9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {open ? (
        <path
          d="M3 11h18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          opacity="0.55"
        />
      ) : null}
    </svg>
  )
}

/** 侧栏图标统一 16×16，避免收纳/展开光学校准不一致 */
export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

export function WorkflowIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="7" cy="8" r="2" />
      <circle cx="17" cy="12" r="2" />
      <circle cx="7" cy="16" r="2" />
      <path d="M9 8h4.5a3.5 3.5 0 0 1 3.5 3.5M9 16h4.5A3.5 3.5 0 0 0 17 12.5" />
    </svg>
  )
}

export function ScheduleIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8.5v4l2.5 1.5" />
    </svg>
  )
}

export function FlowCanvasIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4.5" y="5.5" width="6" height="5" rx="1" />
      <rect x="13.5" y="13.5" width="6" height="5" rx="1" />
      <path d="M10.5 8h3.2a2 2 0 0 1 2 2v3.5" />
    </svg>
  )
}

export function AgentsIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="2.4" />
      <path d="M6.5 18c.6-3 2.8-4.6 5.5-4.6S16.9 15 17.5 18" />
    </svg>
  )
}

export function WritingDeskIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 4h8l3 3v13H7z" />
      <path d="M15 4v3h3" />
      <path d="M10 11h6M10 15h4" strokeLinecap="round" />
    </svg>
  )
}

export function OfficeDeskIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 7h16v12H4z" />
      <path d="M4 11h16" />
      <path d="M8 7V5h8v2" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18" strokeLinecap="round" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

export function GenericNavIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

export function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}
