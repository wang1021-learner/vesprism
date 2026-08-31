/**
 * 权限记忆：
 * - session：这场对话内同命令自动放行（内存，按 tab 分）
 * - always：只信引擎 grant + Rust `~/.vesprism/perm-always.json`，前端不做持久化
 */
import type { PermissionOption, PermissionRequest } from '../types'

/** 命令签名：command 优先，其次 summary，最后 kindLabel/tool 原文 */
export function permissionSignature(p: PermissionRequest): string {
  const c = (p.command || '').trim()
  if (c) return 'cmd:' + c
  const s = (p.summary || '').trim()
  if (s) return 'sum:' + s
  return 'kind:' + (p.kindLabel || p.tool || '')
}

function kindOf(opt: PermissionOption): string {
  return (opt.kind || '').toLowerCase().replace(/-/g, '_')
}

/** 选项识别（与 Permission.tsx 共用） */
export function isAllowOption(opt: PermissionOption): boolean {
  const kind = kindOf(opt)
  if (kind === 'allow_once' || kind === 'allow_always' || kind === 'allow') return true
  if (kind === 'reject_once' || kind === 'reject_always' || kind === 'deny') return false
  const name = opt.name || ''
  const lower = name.toLowerCase()
  return (
    /yes|proceed|allow|approve|accept|run|once/i.test(lower) ||
    name.includes('允许') ||
    name.includes('同意') ||
    name.includes('继续')
  )
}

export function isDenyOption(opt: PermissionOption): boolean {
  const kind = kindOf(opt)
  if (kind === 'reject_once' || kind === 'reject_always' || kind === 'deny') return true
  if (kind === 'allow_once' || kind === 'allow_always' || kind === 'allow') return false
  const name = opt.name || ''
  const lower = name.toLowerCase()
  return (
    /no|deny|reject|cancel|differently|refuse/i.test(lower) ||
    name.includes('拒绝') ||
    name.includes('取消') ||
    name.includes('不允许')
  )
}

export function pickAllowOnce(options: PermissionOption[]): PermissionOption | undefined {
  return options.find((o) => kindOf(o) === 'allow_once') || options.find(isAllowOption)
}

export function pickAllowAlways(options: PermissionOption[]): PermissionOption | undefined {
  return options.find((o) => kindOf(o) === 'allow_always')
}

export function pickRejectOnce(options: PermissionOption[]): PermissionOption | undefined {
  return options.find((o) => kindOf(o) === 'reject_once')
}

export function pickRejectAlways(options: PermissionOption[]): PermissionOption | undefined {
  return options.find((o) => kindOf(o) === 'reject_always')
}

export function pickAllow(options: PermissionOption[]): PermissionOption | undefined {
  return pickAllowOnce(options) || options[0]
}

/** 官方只读工具分类：优先 ACP kind，中文标签只作旧数据兜底。 */
export function isReadOnlyPermission(
  p: Pick<PermissionRequest, 'kindLabel' | 'toolKind'>,
): boolean {
  const kind = (p.toolKind || '').trim().toLowerCase()
  if (kind) return kind === 'read' || kind === 'search' || kind === 'think'
  const k = (p.kindLabel || '').trim()
  return k === '读取文件' || k === '搜索'
}

/** 严格版：只认明确「允许」选项；找不到返回 undefined（UI 用宽松版兜底按钮） */
export function pickAllowStrict(
  options: PermissionOption[],
): PermissionOption | undefined {
  return options.find(isAllowOption)
}

export function pickDeny(options: PermissionOption[]): PermissionOption | undefined {
  return (
    pickRejectOnce(options) ||
    options.find((o) => isDenyOption(o) && kindOf(o) !== 'reject_always')
  )
}

/** 本次会话允许：tabId → 命令签名集合 */
const sessionAllowed = new Map<string, Set<string>>()

export function isSessionAllowed(tabId: string, sig: string): boolean {
  return sessionAllowed.get(tabId)?.has(sig) ?? false
}

export function addSessionAllowed(tabId: string, sig: string): void {
  let set = sessionAllowed.get(tabId)
  if (!set) {
    set = new Set()
    sessionAllowed.set(tabId, set)
  }
  set.add(sig)
}

export function clearSessionAllowed(tabId: string): void {
  sessionAllowed.delete(tabId)
}

/** @deprecated 总是允许只信引擎 grant + ~/.vesprism/perm-always.json，不再写 localStorage。 */
export function isAlwaysAllowed(_sig: string): boolean {
  return false
}
