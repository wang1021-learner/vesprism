/**
 * 审批条文案：标题 / 旁注 / 详情折叠按钮。
 * 不把引擎 kind 原文或「官方 Never allow」甩给用户。
 */
import type { PermissionRequest } from '../types'

export function permissionLead(
  p: Pick<PermissionRequest, 'kindLabel' | 'summary'>,
): { title: string; note: string } {
  const kind = (p.kindLabel || '').trim()
  const title = kind && kind !== '需要审批' ? kind : '需要审批'
  const summary = (p.summary || '').trim()
  const note = summary && summary !== title ? summary : ''
  return { title, note }
}

/** 命令块折叠按钮：终端叫「命令」，改文件叫「目标」，其余叫「详情」 */
export function permissionDetailLabel(kindLabel?: string): string {
  const k = kindLabel || ''
  if (k.includes('终端')) return '命令'
  if (k.includes('文件') || k.includes('读取') || k.includes('编辑')) return '目标'
  return '详情'
}
