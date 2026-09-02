import type { OfficeKind, OfficeTask } from './model'

export function kindLabel(kind: OfficeKind): string {
  if (kind === 'pptx') return '幻灯片预览'
  if (kind === 'xlsx') return '表格预览'
  if (kind === 'pdf') return '文稿预览'
  if (kind === 'report') return '文稿预览'
  return '文稿预览'
}

export function kindIcon(kind: OfficeKind): string {
  if (kind === 'pptx') return 'PPT'
  if (kind === 'xlsx') return 'XLS'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'report') return '报告'
  return 'DOC'
}

export function stepState(task: OfficeTask, i: number): 'done' | 'now' | 'todo' {
  if (i < task.stepIndex || task.status === 'done') return 'done'
  if (i === task.stepIndex && task.status === 'running') return 'now'
  return 'todo'
}
