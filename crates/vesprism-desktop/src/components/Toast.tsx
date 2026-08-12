import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $toasts, dismissToast, type ToastItem } from '../store'

/** 顶部浮层 toast，不进入对话历史 */
export function ToastHost() {
  const toasts = useStore($toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  )
}

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    const t = window.setTimeout(() => dismissToast(item.id), 2200)
    return () => window.clearTimeout(t)
  }, [item.id])

  return (
    <div className={`toast-card tone-${item.tone || 'info'}`} role="status">
      <span className="toast-message">{item.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="关闭"
        onClick={() => dismissToast(item.id)}
      >
        ×
      </button>
    </div>
  )
}
