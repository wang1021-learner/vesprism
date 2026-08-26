import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $toasts, dismissToast, type ToastItem } from '../store'
import { Notice, type NoticeTone } from './Notice'

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
    const ms = item.tone === 'error' ? 5200 : item.tone === 'success' ? 2800 : 2200
    const t = window.setTimeout(() => dismissToast(item.id), ms)
    return () => window.clearTimeout(t)
  }, [item.id, item.tone])

  return (
    <Notice
      tone={(item.tone || 'info') as NoticeTone}
      onDismiss={() => dismissToast(item.id)}
    >
      {item.message}
    </Notice>
  )
}
