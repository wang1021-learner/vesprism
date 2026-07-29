import { useEffect } from 'react'

export type ToastItem = {
  id: string
  message: string
  tone?: 'info' | 'success' | 'error'
}

interface ToastHostProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

/** 顶部浮层 toast，不进入对话历史 */
export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem
  onDismiss: (id: string) => void
}) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(item.id), 2200)
    return () => window.clearTimeout(t)
  }, [item.id, onDismiss])

  return (
    <div className={`toast-card tone-${item.tone || 'info'}`} role="status">
      <span className="toast-message">{item.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="关闭"
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </div>
  )
}
