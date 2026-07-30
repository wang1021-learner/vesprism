import type { PermissionRequest } from '../types'
import { $permission } from '../store'
import { respondPermission } from '../bridge'

interface Props { permission: PermissionRequest | null }

export function PermissionModal({ permission }: Props) {
  if (!permission) return null

  const respond = async (approved: boolean) => {
    const id = Number(permission.id)
    if (!isNaN(id)) {
      await respondPermission(id, approved ? 'allow' : 'deny')
    }
    $permission.set(null)
  }

  return (
    <div className="modal-overlay">
      <div className="modal permission-modal">
        <h2>Approve Tool</h2>
        <p className="permission-tool"><strong>{permission.tool}</strong></p>
        {permission.args && Object.keys(permission.args).length > 0 && (
          <pre className="permission-args">{JSON.stringify(permission.args, null, 2)}</pre>
        )}
        <p className="permission-message">{permission.message}</p>
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => respond(false)}>Deny</button>
          <button className="btn btn-primary" onClick={() => respond(true)}>Allow</button>
        </div>
      </div>
    </div>
  )
}
