import type { ReactNode } from 'react'

export type NoticeTone = 'error' | 'success' | 'info' | 'warning'

function NoticeGlyph({ tone }: { tone: NoticeTone }) {
  if (tone === 'success') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
  }
  if (tone === 'warning') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    )
  }
  if (tone === 'info') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className,
  role,
}: {
  tone?: NoticeTone
  title?: string
  children?: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  className?: string
  role?: 'alert' | 'status'
}) {
  return (
    <div
      className={`notice notice-${tone}${className ? ` ${className}` : ''}`}
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
    >
      <span className="notice-icon" aria-hidden>
        <NoticeGlyph tone={tone} />
      </span>
      <div className={`notice-body${title ? '' : ' notice-plain'}`}>
        {title ? <strong className="notice-title">{title}</strong> : null}
        {children ? <span className="notice-msg">{children}</span> : null}
      </div>
      {action}
      {onDismiss ? (
        <button
          type="button"
          className="notice-dismiss"
          aria-label="关闭"
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
