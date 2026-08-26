/**
 * 权限记忆（once/session/always 语义）：
 * - session：这场对话内同命令自动放行（内存，按 tab 分）
 * - always：同命令永久放行（这台电脑 localStorage）
 * 命中记忆时由 App 直接 respond，不弹审批条。
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

/** 官方只读工具分类：读/搜/思考/拉取，无工作区副作用。 */
export function isReadOnlyPermission(p: Pick<PermissionRequest, 'kindLabel'>): boolean {
  const k = (p.kindLabel || '').trim()
  return k === '读取文件' || k === '搜索' || k === '网络请求'
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
    options.find((o) => isDenyOption(o) && kindOf(o) !== 'reject_always') ||
    options[options.length - 1]
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

/** 总是允许：localStorage 持久化 */
const ALWAYS_KEY = 'jike-perm-always'

function loadAlways(): Set<string> {
  try {
    const raw = localStorage.getItem(ALWAYS_KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function isAlwaysAllowed(sig: string): boolean {
  return loadAlways().has(sig)
}

export function addAlwaysAllowed(sig: string): void {
  const set = loadAlways()
  set.add(sig)
  try {
    localStorage.setItem(ALWAYS_KEY, JSON.stringify([...set]))
  } catch (e) {
    console.warn('[perm] localStorage 不可用，总是允许记忆不生效:', e)
  }
}
