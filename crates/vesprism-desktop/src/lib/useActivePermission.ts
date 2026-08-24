import { useStore } from '@nanostores/react'
import { $permission } from '../store'
import type { PermissionRequest } from '../types'

/** 当前 Tab 的审批请求。单独成文件，避免热更新把 `$permission` 导入弄丢。 */
export function useActivePermission(): PermissionRequest | null {
  return useStore($permission)
}
