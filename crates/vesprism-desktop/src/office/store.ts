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

function nextId(): string {
  return `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function startOfficeTask(
  starterId: string | 'custom',
  prompt: string,
  folderId?: string,
): OfficeTask {
  const fId = folderId ?? $officeFolderId.get()
  const task = createOfficeTask(starterId, prompt, nextId(), fId)
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
  if (currentActive === id) {
    if (filtered.length > 0) {
      $officeActiveId.set(filtered[0].id)
    } else {
      $officeActiveId.set(null)
    }
  }
}

export function resetOfficeTasksForTests(): void {
  $officeTasks.set([])
  $officeActiveId.set(null)
  $officePanel.set('home')
  $officePermission.set('default')
  $officeFolderId.set('week')
  $officeFormat.set('doc')
}
