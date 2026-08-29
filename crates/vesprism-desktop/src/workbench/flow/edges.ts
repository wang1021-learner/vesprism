/** 分支边：落盘只认英文 success/failure + sourceHandle；中文仅展示。 */

const YES = new Set(['success', 'yes', 'true', 'ok', '是', '成功'])
const NO = new Set(['failure', 'no', 'false', '否', '失败'])

export function canonicalBranchLabel(
  handle?: string | null,
  label?: string | null,
): 'success' | 'failure' | undefined {
  const h = (handle || '').trim().toLowerCase()
  const l = (label || '').trim().toLowerCase()
  if (h === 'success' || YES.has(l)) return 'success'
  if (h === 'failure' || NO.has(l)) return 'failure'
  return undefined
}

export function displayBranchLabel(handle?: string | null, label?: string | null): string | undefined {
  const canon = canonicalBranchLabel(handle, label)
  if (canon === 'success') return '成功'
  if (canon === 'failure') return '失败'
  const raw = (label || '').trim()
  if (raw) return raw
  const h = (handle || '').trim()
  return h || undefined
}

export function persistEdgeLabel(handle?: string | null, label?: string | null): string | undefined {
  const canon = canonicalBranchLabel(handle, label)
  if (canon) return canon
  const raw = (label || '').trim()
  return raw || undefined
}

export function persistSourceHandle(handle?: string | null, label?: string | null): string | undefined {
  const canon = canonicalBranchLabel(handle, label)
  if (canon) return canon
  const h = (handle || '').trim()
  return h || undefined
}

export const RHAI_BRANCH_YES = 'success|yes|true|ok|是|成功'
export const RHAI_BRANCH_NO = 'failure|no|false|否|失败'
export const RHAI_BRANCH_BINARY = `${RHAI_BRANCH_YES}|${RHAI_BRANCH_NO}`
