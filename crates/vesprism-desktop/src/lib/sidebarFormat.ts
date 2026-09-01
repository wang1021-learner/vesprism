import { isScratchCwd } from '../store'
import { normalizeWorkspacePath, workspaceFolderName } from './workspacePath'

/** 搜索结果右侧相对时间 */
export function formatSearchTimeLabel(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function normalizeCwdKey(cwd: string | undefined): string {
  return normalizeWorkspacePath(cwd || '') || '(未知工作空间)'
}

export function workspaceDisplayName(cwd: string): string {
  const key = normalizeCwdKey(cwd)
  if (key === '(未知工作空间)') return key
  if (isScratchCwd(cwd)) return '闲聊'
  return workspaceFolderName(cwd)
}
