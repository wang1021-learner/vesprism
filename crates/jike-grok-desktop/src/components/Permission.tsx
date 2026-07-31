import type { PermissionRequest } from '../types'
import { $permission } from '../store'
import { respondPermission } from '../bridge'
import { useEffect, useRef } from 'react'

interface Props { permission: PermissionRequest | null }

export function PermissionModal({ permission }: Props) {
  const denyBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!permission) return
    denyBtnRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        const denyOpt = permission.options.find((o) => o.kind === 'deny') ?? permission.options[permission.options.length - 1]
        if (denyOpt) respond(denyOpt.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission])

  if (!permission) return null

  const respond = async (optionId: string) => {
    const requestId = Number(permission.id)
    if (!isNaN(requestId)) {
      await respondPermission(requestId, optionId)
    }
    $permission.set(null)
    // 响应后把焦点还给输入框
    window.dispatchEvent(new CustomEvent('jike:focus-composer'))
  }

  const kindClass = (kind?: string) => {
    if (kind === 'allow') return 'btn btn-primary'
    if (kind === 'deny') return 'btn btn-danger'
    return 'btn btn-secondary'
  }

  return (
    <div className="modal-overlay">
      <div className="modal permission-modal">
        <h2>工具权限请求</h2>
        <p className="permission-tool"><strong>{permission.tool}</strong></p>
        <div className="modal-actions">
          {permission.options.map((opt) => (
            <button
              key={opt.id}
              ref={opt.kind === 'deny' ? denyBtnRef : undefined}
              className={kindClass(opt.kind)}
              onClick={() => respond(opt.id)}
            >
              {opt.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
