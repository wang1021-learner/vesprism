import {
  advanceOfficeTask,
  type DemoFile,
  type OfficeTask,
  type OfficeTaskStatus,
  type PlanStep,
} from './model'
import {
  type OfficeFormat,
  type OfficePanel,
  type OfficePermission,
} from './catalog'
import {
  $officeActiveId,
  $officeFolderId,
  $officeFormat,
  $officePanel,
  $officePermission,
  $officeTasks,
} from './store'

export const OFFICE_PERSIST_KEY = 'vesprism.office.v1'
export const OFFICE_TASK_LIMIT = 30
export const OFFICE_PREVIEW_MAX = 8_192
export const OFFICE_PROMPT_MAX = 2_048

export type OfficePersistV1 = {
  v: 1
  tasks: OfficeTask[]
  activeId: string | null
  panel: OfficePanel
  folderId: string
  format: OfficeFormat
  permission: OfficePermission
}

const PANELS = new Set<OfficePanel>([
  'home',
  'skills',
  'agents',
  'knowledge',
  'schedule',
  'connectors',
  'history',
])

export function normalizeOfficePanel(raw: unknown): OfficePanel {
  if (raw === 'experts') return 'agents'
  if (typeof raw === 'string' && PANELS.has(raw as OfficePanel)) return raw as OfficePanel
  return 'home'
}
const FOLDERS = new Set(['week', 'project_alpha', 'none'])
const PERMS = new Set<OfficePermission>(['ask', 'default', 'full'])
const KINDS = new Set(['doc', 'pptx', 'xlsx', 'pdf', 'report'])
const STATUSES = new Set<OfficeTaskStatus>(['idle', 'running', 'done'])

let booted = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
const unsubs: Array<() => void> = []

export function normalizeOfficeFormat(raw: unknown): OfficeFormat {
  if (raw === 'pptx' || raw === 'xlsx' || raw === 'doc') return raw
  return 'doc'
}

export function formatOfficeClock(createdAt: string): string {
  if (/^\d{2}:\d{2}$/.test(createdAt)) return createdAt
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return createdAt
  const d = new Date(t)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function isPlanStep(raw: unknown): raw is PlanStep {
  if (!raw || typeof raw !== 'object') return false
  const s = raw as PlanStep
  return typeof s.id === 'string' && typeof s.label === 'string'
}

export function isLoadableDemoFile(raw: unknown): raw is DemoFile {
  if (!raw || typeof raw !== 'object') return false
  const f = raw as DemoFile
  if (typeof f.name !== 'string' || typeof f.title !== 'string') return false
  if (typeof f.kind !== 'string' || !KINDS.has(f.kind)) return false
  if (typeof f.summary !== 'string' || typeof f.preview !== 'string') return false
  if (f.kind === 'pptx') {
    if (!Array.isArray(f.slides) || f.slides.length === 0) return false
    for (const s of f.slides) {
      if (!s || typeof s !== 'object') return false
      if (typeof s.index !== 'number' || typeof s.title !== 'string' || !Array.isArray(s.points)) {
        return false
      }
    }
  }
  if (f.kind === 'xlsx') {
    if (!Array.isArray(f.tableColumns) || f.tableColumns.length === 0) return false
    if (!Array.isArray(f.tableRows)) return false
    for (const c of f.tableColumns) {
      if (!c || typeof c.key !== 'string' || typeof c.label !== 'string') return false
    }
  }
  return true
}

export function isLoadableTask(raw: unknown): raw is OfficeTask {
  if (!raw || typeof raw !== 'object') return false
  const t = raw as OfficeTask
  if (typeof t.id !== 'string' || typeof t.title !== 'string') return false
  if (typeof t.starterId !== 'string' || typeof t.prompt !== 'string') return false
  if (typeof t.createdAt !== 'string') return false
  if (!STATUSES.has(t.status) || !Number.isFinite(t.stepIndex)) return false
  if (!Array.isArray(t.plan) || !t.plan.every(isPlanStep)) return false
  if (t.folderId != null && typeof t.folderId !== 'string') return false
  if (t.toolLog != null && (!Array.isArray(t.toolLog) || t.toolLog.some((x) => typeof x !== 'string'))) {
    return false
  }
  if (t.file != null && !isLoadableDemoFile(t.file)) return false
  return true
}

function truncateTask(task: OfficeTask): OfficeTask {
  const prompt =
    task.prompt.length > OFFICE_PROMPT_MAX ? task.prompt.slice(0, OFFICE_PROMPT_MAX) : task.prompt
  let file = task.file
  if (file && file.preview.length > OFFICE_PREVIEW_MAX) {
    file = { ...file, preview: file.preview.slice(0, OFFICE_PREVIEW_MAX) }
  }
  return { ...task, prompt, file }
}

function finishIncomplete(task: OfficeTask): OfficeTask | null {
  let cur = { ...task, format: normalizeOfficeFormat(task.format), plan: task.plan.map((s) => ({ ...s })) }
  const cap = cur.plan.length + 2
  for (let i = 0; i < cap && (cur.status !== 'done' || cur.file == null); i++) {
    cur = advanceOfficeTask(cur)
  }
  if (cur.status !== 'done' || cur.file == null) return null
  return truncateTask(cur)
}

export function hydrateOfficeTasks(raw: unknown): OfficePersistV1 {
  const empty: OfficePersistV1 = {
    v: 1,
    tasks: [],
    activeId: null,
    panel: 'home',
    folderId: 'week',
    format: 'doc',
    permission: 'default',
  }
  if (!raw || typeof raw !== 'object') {
    console.warn('[office] persist 不是对象，丢弃')
    return empty
  }
  const blob = raw as { v?: unknown }
  if (blob.v !== 1) {
    console.warn('[office] persist 版本不是 1，丢弃')
    return empty
  }
  const src = raw as OfficePersistV1
  const tasks: OfficeTask[] = []
  if (Array.isArray(src.tasks)) {
    for (const item of src.tasks) {
      if (!isLoadableTask(item)) {
        console.warn('[office] 跳过坏任务')
        continue
      }
      const normalized: OfficeTask = {
        ...item,
        format: normalizeOfficeFormat((item as OfficeTask).format),
      }
      if (normalized.file && Array.isArray(normalized.file.riskItems)) {
        const ok = normalized.file.riskItems.every(
          (r) =>
            r &&
            typeof r.id === 'string' &&
            typeof r.clause === 'string' &&
            (r.level === 'high' || r.level === 'medium' || r.level === 'low'),
        )
        if (!ok) normalized.file = { ...normalized.file, riskItems: undefined }
      }
      if (normalized.file && Array.isArray(normalized.file.actionItems)) {
        const ok = normalized.file.actionItems.every(
          (a) => a && typeof a.id === 'string' && typeof a.task === 'string',
        )
        if (!ok) normalized.file = { ...normalized.file, actionItems: undefined }
      }
      const done =
        normalized.status !== 'done' || normalized.file == null
          ? finishIncomplete(normalized)
          : truncateTask(normalized)
      if (done) tasks.push(done)
    }
  }
  const kept = tasks.slice(0, OFFICE_TASK_LIMIT)
  const activeId =
    typeof src.activeId === 'string' && kept.some((t) => t.id === src.activeId) ? src.activeId : null
  return {
    v: 1,
    tasks: kept,
    activeId,
    panel: normalizeOfficePanel(src.panel),
    folderId: FOLDERS.has(src.folderId) ? src.folderId : 'week',
    format: normalizeOfficeFormat(src.format),
    permission: PERMS.has(src.permission) ? src.permission : 'default',
  }
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function loadOfficePersist(): OfficePersistV1 | null {
  const s = storage()
  if (!s) return null
  const raw = s.getItem(OFFICE_PERSIST_KEY)
  if (!raw) return null
  try {
    return hydrateOfficeTasks(JSON.parse(raw) as unknown)
  } catch (e) {
    console.warn('[office] persist JSON 坏了', e)
    return null
  }
}

export function saveOfficePersist(data: OfficePersistV1): void {
  const s = storage()
  if (!s) return
  const clipped: OfficePersistV1 = {
    ...data,
    tasks: data.tasks.slice(0, OFFICE_TASK_LIMIT).map(truncateTask),
  }
  try {
    s.setItem(OFFICE_PERSIST_KEY, JSON.stringify(clipped))
  } catch (e) {
    console.warn('[office] persist 写入失败', e)
  }
}

function snapshot(): OfficePersistV1 {
  return {
    v: 1,
    tasks: $officeTasks.get(),
    activeId: $officeActiveId.get(),
    panel: $officePanel.get(),
    folderId: $officeFolderId.get(),
    format: $officeFormat.get(),
    permission: $officePermission.get(),
  }
}

export function saveOfficePersistNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saveOfficePersist(snapshot())
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveOfficePersist(snapshot())
  }, 200)
}

function applyHydrated(data: OfficePersistV1): void {
  $officeTasks.set(data.tasks)
  $officeActiveId.set(data.activeId)
  $officePanel.set(data.panel)
  $officeFolderId.set(data.folderId)
  $officeFormat.set(data.format)
  $officePermission.set(data.permission)
}

export function bootOfficePersist(): void {
  if (booted) return
  booted = true
  const loaded = loadOfficePersist()
  if (loaded) applyHydrated(loaded)
  unsubs.push($officeTasks.listen(scheduleSave))
  unsubs.push($officeActiveId.listen(scheduleSave))
  unsubs.push($officePanel.listen(scheduleSave))
  unsubs.push($officeFolderId.listen(scheduleSave))
  unsubs.push($officeFormat.listen(scheduleSave))
  unsubs.push($officePermission.listen(scheduleSave))
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const flushHidden = () => {
    if (document.visibilityState === 'hidden') saveOfficePersistNow()
  }
  window.addEventListener('visibilitychange', flushHidden)
  window.addEventListener('beforeunload', saveOfficePersistNow)
  unsubs.push(() => {
    window.removeEventListener('visibilitychange', flushHidden)
    window.removeEventListener('beforeunload', saveOfficePersistNow)
  })
}

export function resetOfficePersistForTests(): void {
  booted = false
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  for (const u of unsubs) u()
  unsubs.length = 0
  $officeTasks.set([])
  $officeActiveId.set(null)
  $officePanel.set('home')
  $officePermission.set('default')
  $officeFolderId.set('week')
  $officeFormat.set('doc')
  const s = storage()
  s?.removeItem(OFFICE_PERSIST_KEY)
}
