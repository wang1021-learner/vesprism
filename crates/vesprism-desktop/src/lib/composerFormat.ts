import { isScratchCwd, workspaceLabel } from '../store'

export function formatTokenK(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  if (k < 10) return `${k.toFixed(1)}K`
  if (k < 1000) return `${Math.round(k)}K`
  return `${(k / 1000).toFixed(1)}M`
}

export function formatWorkspaceLabel(p: string): string {
  if (!p || isScratchCwd(p)) return '闲聊'
  return workspaceLabel(p)
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}
