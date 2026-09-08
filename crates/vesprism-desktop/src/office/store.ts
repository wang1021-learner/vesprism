import { atom } from 'nanostores'
import { $rightPanelOpen } from '../store'
import {
  advanceOfficeTask,
  applyRefinement,
  createOfficeTask,
  tickStreamCursor,
  type OfficeTask,
} from './model'
import type { OfficeFormat, OfficePanel, OfficePermission } from './catalog'

export const $officeTasks = atom<OfficeTask[]>([])
export const $officeActiveId = atom<string | null>(null)
export const $officePanel = atom<OfficePanel>('home')
export const $officePermission = atom<OfficePermission>('default')
/** @deprecated 不再单独代表右栏材料源；挂载时同步 folderId，供 persist / 兼容。 */
export const $officeFolderId = atom<string>('week')
export const $officeFormat = atom<OfficeFormat>('doc')

/** 材料 chip 上限（产品已锁定）。 */
export const MAX_OFFICE_MATERIAL_FILES = 3

/**
 * 当前材料上下文：单一事实源。
 * null = 未挂载；fileIds 最多 MAX_OFFICE_MATERIAL_FILES。
 */
export type OfficeMaterialContext = {
  folderId: string
  fileIds: string[]
}
export const $officeMaterialContext = atom<OfficeMaterialContext | null>(null)

/**
 * 右侧面板当前激活标签页。
 * v2 UI 固定产物；`files` / `history` 仅 deprecate，无入口。
 * - `artifact` 产物（进办公 / 回工作台 / 开跑默认）
 * - `files` **@deprecated** 无 UI
 * - `history` **@deprecated** P0 隐藏入口，字段保留不删
 */
export type OfficeRailTab = 'artifact' | 'files' | 'history'
/** @deprecated P0 隐藏历史 Tab 入口；类型与字段保留兼容 */
export type OfficeRailTabDeprecatedHistory = Extract<OfficeRailTab, 'history'>
/** @deprecated 无材料 Tab UI；保留类型兼容 */
export type OfficeRailTabDeprecatedFiles = Extract<OfficeRailTab, 'files'>
export const $officeRailTab = atom<OfficeRailTab>('artifact')

/** @deprecated 右栏材料预览 id；v2 无 UI，字段保留兼容。 */
export const $officePreviewFileId = atom<string | null>(null)

/** 假流式 / tick 演示中断时的中央错误条文案；null 表示无错。 */
export const $officeDemoError = atom<string | null>(null)

/** 会话内归档集合（不落盘，刷新即复位）。 */
export const $officeArchivedIds = atom<string[]>([])
/** 会话内星标集合（不落盘，刷新即复位）。 */
export const $officeStarredIds = atom<string[]>([])
/** 右栏「以此起草/以此为准」预填给首页 dock 的草稿种子（消费后置空；v2 无右栏材料主路径 UI）。 */
export const $officeDraftSeed = atom<string | null>(null)

function nextId(): string {
  return `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function normalizeFileIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_OFFICE_MATERIAL_FILES) break
  }
  return out
}

/** 挂载一份材料文件（同夹追加；换夹则重置为该夹）。 */
export function mountOfficeMaterial(folderId: string, fileId: string): void {
  if (!folderId || folderId === 'none' || !fileId) return
  const cur = $officeMaterialContext.get()
  let nextIds: string[]
  if (!cur || cur.folderId !== folderId) {
    nextIds = [fileId]
  } else if (cur.fileIds.includes(fileId)) {
    return
  } else if (cur.fileIds.length >= MAX_OFFICE_MATERIAL_FILES) {
    return
  } else {
    nextIds = [...cur.fileIds, fileId]
  }
  const ctx: OfficeMaterialContext = {
    folderId,
    fileIds: normalizeFileIds(nextIds),
  }
  $officeMaterialContext.set(ctx)
  $officeFolderId.set(folderId)
}

/** 卸下一份已挂载材料；卸空则置 null。 */
export function unmountOfficeMaterial(fileId: string): void {
  const cur = $officeMaterialContext.get()
  if (!cur) return
  const nextIds = cur.fileIds.filter((id) => id !== fileId)
  if (nextIds.length === 0) {
    $officeMaterialContext.set(null)
    return
  }
  $officeMaterialContext.set({ folderId: cur.folderId, fileIds: nextIds })
}

export function clearOfficeMaterialContext(): void {
  $officeMaterialContext.set(null)
}

export function openOfficeArtifact(): void {
  $rightPanelOpen.set(true)
  $officeRailTab.set('artifact')
}

/** 进办公 / 回工作台：右栏常驻开、默认产物空态。 */
export function ensureOfficeRailHome(): void {
  $rightPanelOpen.set(true)
  $officeRailTab.set('artifact')
  $officeDemoError.set(null)
}

export function startOfficeTask(
  starterId: string | 'custom',
  prompt: string,
  folderId?: string,
  format?: OfficeFormat,
  fileIds?: string[],
): OfficeTask {
  const ctx = $officeMaterialContext.get()
  const fId = folderId ?? ctx?.folderId ?? $officeFolderId.get()
  const ids = normalizeFileIds(fileIds ?? ctx?.fileIds ?? [])
  const fmt = format ?? $officeFormat.get()
  const task = createOfficeTask(starterId, prompt, nextId(), fId, fmt, ids)
  $officeTasks.set([task, ...$officeTasks.get()])
  $officeActiveId.set(task.id)
  $officePanel.set('home')
  $officeDemoError.set(null)
  $rightPanelOpen.set(true)
  $officeRailTab.set('artifact')
  return task
}

export function selectOfficeTask(id: string): void {
  if ($officeTasks.get().some((t) => t.id === id)) {
    $officeActiveId.set(id)
    $officePanel.set('home')
    $officeDemoError.set(null)
    $rightPanelOpen.set(true)
    $officeRailTab.set('artifact')
  }
}

export function openOfficePanel(panel: OfficePanel): void {
  $officePanel.set(panel)
  if (panel !== 'home') $officeActiveId.set(null)
}

export function openOfficeHome(): void {
  $officeActiveId.set(null)
  $officePanel.set('home')
  ensureOfficeRailHome()
}

export function patchOfficeTask(id: string, next: OfficeTask): void {
  $officeTasks.set($officeTasks.get().map((t) => (t.id === id ? next : t)))
}

export function tickOfficeTask(id: string): OfficeTask | null {
  try {
    const cur = $officeTasks.get().find((t) => t.id === id)
    if (!cur || cur.status === 'done') return null
    // 如果已经在流式阶段（stepIndex >= plan.length），执行逐字光标步进
    if (cur.stepIndex >= cur.plan.length && cur.streamCursor !== undefined) {
      const next = tickStreamCursor(cur)
      patchOfficeTask(id, next)
      return next
    }
    const next = advanceOfficeTask(cur)
    patchOfficeTask(id, next)
    return next
  } catch (err) {
    console.error('[office] tick failed', err)
    $officeDemoError.set('演示中断，可回工作台重试')
    return null
  }
}

export function refineOfficeTask(id: string, action: string): OfficeTask | null {
  const cur = $officeTasks.get().find((t) => t.id === id)
  if (!cur) return null
  const next = applyRefinement(cur, action)
  patchOfficeTask(id, next)
  // 改稿完成后聚焦右侧画板
  openOfficeArtifact()
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

/** 右栏「放入输入框」：写入草稿种子并回首页 dock（v2 无材料主路径 UI，函数保留）。 */
export function seedOfficeDraft(text: string): void {
  $officeDraftSeed.set(text)
  openOfficeHome()
}

/** 「再来一份」：按原任务的 starter / prompt / 夹 / 格式 / 材料快照重开一次演示任务。 */
export function duplicateOfficeTask(id: string): OfficeTask | null {
  const t = $officeTasks.get().find((x) => x.id === id)
  if (!t) return null
  return startOfficeTask(t.starterId, t.prompt, t.folderId, t.format, t.fileIds)
}

export function resetOfficeTasksForTests(): void {
  $officeTasks.set([])
  $officeActiveId.set(null)
  $officePanel.set('home')
  $officePermission.set('default')
  $officeFolderId.set('week')
  $officeFormat.set('doc')
  $officeMaterialContext.set(null)
  $officeArchivedIds.set([])
  $officeStarredIds.set([])
  $officeDraftSeed.set(null)
  $officePreviewFileId.set(null)
  $officeDemoError.set(null)
  $officeRailTab.set('artifact')
}
