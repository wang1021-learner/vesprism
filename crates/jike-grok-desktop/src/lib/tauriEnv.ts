/** 检测是否运行在 Tauri WebView 环境 */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
    isTauri?: boolean
  }
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.isTauri)
}
