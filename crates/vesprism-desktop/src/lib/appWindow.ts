/**
 * 缓存当前窗口句柄，避免顶栏每次 mousedown / 按钮点击都 new 一次。
 */
import { getCurrentWindow, type Window } from '@tauri-apps/api/window'

let cached: Window | null = null

export function appWindow(): Window {
  return (cached ??= getCurrentWindow())
}
