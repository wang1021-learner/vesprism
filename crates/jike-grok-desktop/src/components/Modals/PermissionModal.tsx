import { useEffect, useRef } from 'react'
import type { PermissionOption, PermissionRequest } from '../../types'

interface PermissionModalProps {
  permission: PermissionRequest
  onRespond: (optionId: string) => void
}

/** 优先用后端 kind；缺失时再猜 id/name（兼容旧事件） */
function optionKind(o: PermissionOption): 'allow' | 'deny' | 'other' {
  if (o.kind === 'allow' || o.kind === 'deny' || o.kind === 'other') return o.kind
  const i = o.id.toLowerCase()
  const n = o.name.toLowerCase()
  if (
    i.includes('reject') ||
    i.includes('deny') ||
    i.includes('cancel') ||
    n.includes('reject') ||
    n.includes('deny') ||
    n.includes('cancel') ||
    o.name.includes('拒绝') ||
    o.name.includes('取消') ||
    o.name.includes('不允许')
  ) {
    return 'deny'
  }
  if (
    i.includes('allow') ||
    i.includes('approve') ||
    i.includes('accept') ||
    n.includes('allow') ||
    n.includes('approve') ||
    n.includes('yes') ||
    o.name.includes('允许') ||
    o.name.includes('同意') ||
    o.name.includes('始终')
  ) {
    return 'allow'
  }
  return 'other'
}

export function PermissionModal({ permission, onRespond }: PermissionModalProps) {
  const denyButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    denyButtonRef.current?.focus()
  }, [permission.request_id])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const denyOpt = permission.options.find((o) => optionKind(o) === 'deny')
        if (denyOpt) onRespond(denyOpt.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [permission.options, onRespond])

  const firstDenyId = permission.options.find((o) => optionKind(o) === 'deny')?.id

  return (
    <div className="modal-backdrop permission-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card permission-card">
        <div className="modal-header">
          <h2>需要权限</h2>
        </div>
        <p className="permission-hint">
          Agent 想执行以下操作，请选择是否允许。未选择前界面会保持等待。 按 Esc
          可快速拒绝。
        </p>
        <pre className="permission-desc">{permission.description}</pre>
        <div className="modal-actions permission-actions">
          {permission.options.map((o) => {
            const kind = optionKind(o)
            const cls = [
              'btn',
              kind === 'deny' ? 'btn-danger' : '',
              kind === 'allow' ? 'btn-primary' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const isFirstDeny = o.id === firstDenyId
            return (
              <button
                key={o.id}
                type="button"
                className={cls}
                ref={isFirstDeny ? denyButtonRef : undefined}
                onClick={() => onRespond(o.id)}
              >
                {o.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
