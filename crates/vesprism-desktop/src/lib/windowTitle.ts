/**
 * 窗口系统标题同步：跟随活跃 Tab 的会话标题（任务栏 / Alt-Tab 可读）。
 * 非 Tauri 环境（浏览器预览）静默忽略。
 */
import { appWindow } from './appWindow'

let lastTitle = ''

const UTILITY_KINDS = new Set([
  'flow-canvas',
  'agents',
  'mcp',
  'tools',
  'skills',
  'workflows',
])

/** 专用面板不写进窗口标题，只留 Vesprism；普通对话仍跟会话名。 */
export function titleForWindow(title?: string, utilityKind?: string | null): string {
  if (utilityKind && UTILITY_KINDS.has(utilityKind)) {
    return ''
  }
  return (title || '').trim()
}

export function syncWindowTitle(title?: string): void {
  const next = (title || '').trim() ? `Vesprism · ${(title || '').trim()}` : 'Vesprism'
  if (next === lastTitle) return
  lastTitle = next
  try {
    void appWindow().setTitle(next).catch(() => {})
  } catch {
    /* 浏览器预览等非 Tauri 环境 */
  }
}
