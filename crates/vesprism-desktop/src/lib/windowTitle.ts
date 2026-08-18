/**
 * 窗口系统标题：保持纯净固定为 Vesprism。
 * 非 Tauri 环境（浏览器预览）静默忽略。
 */
import { appWindow } from './appWindow'

let lastTitle = ''

export function titleForWindow(_title?: string, _utilityKind?: string | null): string {
  return ''
}

export function syncWindowTitle(_title?: string): void {
  const next = 'Vesprism'
  if (next === lastTitle) return
  lastTitle = next
  try {
    void appWindow().setTitle(next).catch(() => {})
  } catch {
    /* 浏览器预览等非 Tauri 环境 */
  }
}
