/**
 * 窗口系统标题同步：跟随活跃 Tab 的会话标题（任务栏 / Alt-Tab 可读）。
 * 非 Tauri 环境（浏览器预览）静默忽略。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'

export function syncWindowTitle(title?: string): void {
  const t = (title || '').trim()
  try {
    void getCurrentWindow().setTitle(t ? `Vesprism · ${t}` : 'Vesprism')
  } catch {
    /* 浏览器预览等非 Tauri 环境 */
  }
}
