import { useEffect, useRef } from 'react'
import type { PermissionRequest } from '../../types'

interface PermissionModalProps {
  permission: PermissionRequest
  onRespond: (optionId: string) => void
}

/** 粗略区分「允许类 / 拒绝类」：优先看 id（更稳定、不受协议文案调整影响），
 *  id 无法判断时兜底用 name 文本关键词匹配 */
function isDenyOption(id: string, name: string): boolean {
  const i = id.toLowerCase()
  if (i.includes('reject') || i.includes('deny') || i.includes('cancel')) return true
  const n = name.toLowerCase()
  return (
    n.includes('reject') ||
    n.includes('deny') ||
    n.includes('cancel') ||
    n.includes('拒绝') ||
    n.includes('取消') ||
    n.includes('不允许')
  )
}

function isAllowOption(id: string, name: string): boolean {
  const i = id.toLowerCase()
  if (i.includes('allow') || i.includes('approve') || i.includes('accept')) return true
  const n = name.toLowerCase()
  return (
    n.includes('allow') ||
    n.includes('approve') ||
    n.includes('yes') ||
    n.includes('允许') ||
    n.includes('同意') ||
    n.includes('始终')
  )
}

export function PermissionModal({ permission, onRespond }: PermissionModalProps) {
  const denyButtonRef = useRef<HTMLButtonElement>(null)

  // 弹窗出现时：默认聚焦到"拒绝类"按钮（找不到则聚焦第一个按钮），
  // 避免用户手滑按回车误触发允许类操作
  useEffect(() => {
    denyButtonRef.current?.focus()
  }, [permission.request_id])

  // Esc 键：如果存在拒绝类选项，直接触发；不存在则不响应（不允许 Esc 意外批准）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const denyOpt = permission.options.find((o) => isDenyOption(o.id, o.name))
        if (denyOpt) {
          onRespond(denyOpt.id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [permission.options, onRespond])

  const denyOptions = permission.options.filter((o) => isDenyOption(o.id, o.name))
  const firstDenyId = denyOptions[0]?.id

  return (
    <div className="modal-backdrop permission-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card permission-card">
        <div className="modal-header">
          <h2>需要权限</h2>
        </div>
        <p className="permission-hint">
          Agent 想执行以下操作，请选择是否允许。未选择前界面会保持等待。
          按 Esc 可快速拒绝。
        </p>
        <pre className="permission-desc">{permission.description}</pre>
        <div className="modal-actions permission-actions">
          {permission.options.map((o) => {
            const deny = isDenyOption(o.id, o.name)
            const allow = isAllowOption(o.id, o.name)
            const cls = [
              'btn-modal-action',
              allow ? 'btn-permission-allow' : '',
              deny ? 'btn-permission-deny' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={o.id}
                type="button"
                ref={o.id === firstDenyId ? denyButtonRef : undefined}
                className={cls}
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
