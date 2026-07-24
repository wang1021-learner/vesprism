import type { PermissionRequest } from '../../types'

interface PermissionModalProps {
  permission: PermissionRequest
  onRespond: (optionId: string) => void
}

/** 粗略区分「允许类 / 拒绝类」按钮样式 */
function isDenyOption(name: string): boolean {
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

function isAllowOption(name: string): boolean {
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
  return (
    <div className="modal-backdrop permission-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card permission-card">
        <div className="modal-header">
          <h2>需要权限</h2>
        </div>
        <p className="permission-hint">
          Agent 想执行以下操作，请选择是否允许。未选择前界面会保持等待。
        </p>
        <pre className="permission-desc">{permission.description}</pre>
        <div className="modal-actions permission-actions">
          {permission.options.map((o) => {
            const deny = isDenyOption(o.name)
            const allow = isAllowOption(o.name)
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
