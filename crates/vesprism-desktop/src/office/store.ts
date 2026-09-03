import { atom } from 'nanostores'
import {
  advanceOfficeTask,
  applyRefinement,
  createOfficeTask,
  type OfficeTask,
} from './model'
import type { OfficeFormat, OfficePanel, OfficePermission } from './catalog'

export const $officeTasks = atom<OfficeTask[]>([])
export const $officeActiveId = atom<string | null>(null)
export const $officePanel = atom<OfficePanel>('home')
export const $officePermission = atom<OfficePermission>('default')
export const $officeFolderId = atom<string>('week')
export const $officeFormat = atom<OfficeFormat>('doc')

/** 会话内归档集合（不落盘，刷新即复位）。 */
export const $officeArchivedIds = atom<string[]>([])
/** 会话内星标集合（不落盘，刷新即复位）。 */
export const $officeStarredIds = atom<string[]>([])
/** 右栏「以此起草/以此为准」预填给首页 dock 的草稿种子（消费后置空）。 */
export const $officeDraftSeed = atom<string | null>(null)

function nextId(): string {
  return `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function startOfficeTask(
  starterId: string | 'custom',
  prompt: string,
  folderId?: string,
  format?: OfficeFormat,
): OfficeTask {
  const fId = folderId ?? $officeFolderId.get()
  const fmt = format ?? $officeFormat.get()
  const task = createOfficeTask(starterId, prompt, nextId(), fId, fmt)
  $officeTasks.set([task, ...$officeTasks.get()])
  $officeActiveId.set(task.id)
  $officePanel.set('home')
  return task
}

export function selectOfficeTask(id: string): void {
  if ($officeTasks.get().some((t) => t.id === id)) {
    $officeActiveId.set(id)
    $officePanel.set('home')
  }
}

export function openOfficePanel(panel: OfficePanel): void {
  $officePanel.set(panel)
  if (panel !== 'home') $officeActiveId.set(null)
}

export function openOfficeHome(): void {
  $officeActiveId.set(null)
  $officePanel.set('home')
}

export function patchOfficeTask(id: string, next: OfficeTask): void {
  $officeTasks.set($officeTasks.get().map((t) => (t.id === id ? next : t)))
}

export function tickOfficeTask(id: string): OfficeTask | null {
  const cur = $officeTasks.get().find((t) => t.id === id)
  if (!cur) return null
  const next = advanceOfficeTask(cur)
  patchOfficeTask(id, next)
  return next
}

export function refineOfficeTask(id: string, action: string): OfficeTask | null {
  const cur = $officeTasks.get().find((t) => t.id === id)
  if (!cur) return null
  const next = applyRefinement(cur, action)
  patchOfficeTask(id, next)
  return next
}

export function deleteOfficeTask(id: string): void {
  const currentActive = $officeActiveId.get()
  const filtered = $officeTasks.get().filter((t) => t.id !== id)
  $officeTasks.set(filtered)
  $officeArchivedIds.set($officeArchivedIds.get().filter((x) => x !== id))
  $officeStarredIds.set($officeStarredIds.get().filter((x) => x !== id))
  if (currentActive === id) {
    if (filtered.length > 0) {
      $officeActiveId.set(filtered[0].id)
    } else {
      $officeActiveId.set(null)
    }
  }
}

export function isOfficeArchived(id: string): boolean {
  return $officeArchivedIds.get().includes(id)
}

/** 归档 / 取消归档（会话内本地展示，不写盘）。 */
export function archiveOfficeTask(id: string): void {
  const cur = $officeArchivedIds.get()
  $officeArchivedIds.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
}

export function isOfficeStarred(id: string): boolean {
  return $officeStarredIds.get().includes(id)
}

/** 星标 / 取消星标（会话内本地展示，不写盘）。 */
export function toggleOfficeStar(id: string): void {
  const cur = $officeStarredIds.get()
  $officeStarredIds.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
}

/** 右栏「以此起草」：写入草稿种子并回首页 dock，让用户审稿后再提交。 */
export function seedOfficeDraft(text: string): void {
  $officeDraftSeed.set(text)
  openOfficeHome()
}

/** 「再来一份」：按原任务的 starter / prompt / 夹 / 格式重开一次演示任务。 */
export function duplicateOfficeTask(id: string): OfficeTask | null {
  const t = $officeTasks.get().find((x) => x.id === id)
  if (!t) return null
  return startOfficeTask(t.starterId, t.prompt, t.folderId, t.format)
}

export function resetOfficeTasksForTests(): void {
  $officeTasks.set([])
  $officeActiveId.set(null)
  $officePanel.set('home')
  $officePermission.set('default')
  $officeFolderId.set('week')
  $officeFormat.set('doc')
  $officeArchivedIds.set([])
  $officeStarredIds.set([])
  $officeDraftSeed.set(null)
}
