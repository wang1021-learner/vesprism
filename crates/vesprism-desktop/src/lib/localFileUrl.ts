/**
 * 把本机路径变成 WebView 能加载的地址（官方 convertFileSrc / asset 协议）。
 */
import { convertFileSrc } from '@tauri-apps/api/core'

export function localFileUrl(path: string): string {
  const p = (path || '').trim()
  if (!p) return ''
  try {
    return convertFileSrc(p)
  } catch {
    return ''
  }
}
