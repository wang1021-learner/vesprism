/**
 * 官方后台任务：增量 `task_backgrounded` + 耐用快照 `BackgroundTasks`。
 * 权威 map key = taskId（快照无 tool_call_id）；toolCallId 仅作工具行徽标反查。
 */
import type { BackgroundTaskInfo } from '../store'

export type BackgroundTaskSnapshotRow = {
  taskId: string
  command: string
  displayCommand?: string | null
  description?: string | null
  cwd?: string
  kind?: string
  status?: string
  startedAt?: string
  endedAt?: string | null
  outputFile?: string | null
  exitCode?: number | null
  signal?: string | null
}

function preserveLocal(
  prev: BackgroundTaskInfo | undefined,
  row: BackgroundTaskSnapshotRow,
): BackgroundTaskInfo {
  const monitor =
    row.kind === 'monitor'
      ? row.description || prev?.monitorDescription || '监视'
      : prev?.monitorDescription ?? null
  return {
    taskId: row.taskId,
    command: row.displayCommand || row.command || prev?.command || '',
    outputFile: row.outputFile ?? prev?.outputFile,
    monitorDescription: monitor,
    description: row.description ?? prev?.description ?? null,
    lastEvents: prev?.lastEvents,
    toolCallId: prev?.toolCallId,
    cwd: row.cwd ?? prev?.cwd,
    kind: row.kind ?? prev?.kind,
    status: row.status ?? prev?.status,
    startedAt: row.startedAt ?? prev?.startedAt,
    endedAt: row.endedAt ?? prev?.endedAt,
    exitCode: row.exitCode ?? prev?.exitCode,
    signal: row.signal ?? prev?.signal,
  }
}

/** 全量快照：`truncated=false` 时按 taskId 整表替换；`truncated=true` 只 upsert，不删缺项。 */
export function applyBackgroundTasksSnapshot(
  prev: Record<string, BackgroundTaskInfo>,
  rows: BackgroundTaskSnapshotRow[],
  truncated: boolean,
): Record<string, BackgroundTaskInfo> {
  if (!truncated) {
    const next: Record<string, BackgroundTaskInfo> = {}
    for (const row of rows) {
      if (!row.taskId) continue
      next[row.taskId] = preserveLocal(prev[row.taskId], row)
    }
    return next
  }
  const next = { ...prev }
  for (const row of rows) {
    if (!row.taskId) continue
    next[row.taskId] = preserveLocal(prev[row.taskId], row)
  }
  return next
}

/** 增量转入后台：按 taskId upsert，并记下 toolCallId 供工具行查找。 */
export function upsertBackgroundTaskIncremental(
  prev: Record<string, BackgroundTaskInfo>,
  toolCallId: string,
  info: {
    taskId: string
    command: string
    outputFile?: string
    monitorDescription?: string | null
    description?: string | null
  },
): Record<string, BackgroundTaskInfo> {
  if (!info.taskId) return prev
  const existing =
    prev[info.taskId] ||
    (toolCallId ? prev[toolCallId] : undefined) ||
    Object.values(prev).find((t) => t.taskId === info.taskId)
  const next = { ...prev }
  // 旧 map 曾用 toolCallId 当 key：清掉同 taskId 的非权威 key，避免双份
  for (const [k, v] of Object.entries(next)) {
    if (k !== info.taskId && v.taskId === info.taskId) {
      delete next[k]
    }
  }
  if (toolCallId && toolCallId !== info.taskId && next[toolCallId]) {
    delete next[toolCallId]
  }
  next[info.taskId] = {
    taskId: info.taskId,
    command: info.command || existing?.command || '',
    outputFile: info.outputFile ?? existing?.outputFile,
    monitorDescription: info.monitorDescription ?? existing?.monitorDescription ?? null,
    description: info.description ?? existing?.description ?? null,
    lastEvents: existing?.lastEvents,
    toolCallId: toolCallId || existing?.toolCallId,
    cwd: existing?.cwd,
    kind: existing?.kind,
    status: existing?.status ?? 'running',
    startedAt: existing?.startedAt,
    endedAt: existing?.endedAt,
    exitCode: existing?.exitCode,
    signal: existing?.signal,
  }
  return next
}

export function findBackgroundTaskByToolCallId(
  tasks: Record<string, BackgroundTaskInfo>,
  toolCallId: string,
): BackgroundTaskInfo | undefined {
  if (!toolCallId) return undefined
  if (tasks[toolCallId]) return tasks[toolCallId]
  return Object.values(tasks).find((t) => t.toolCallId === toolCallId)
}

/** 条上只展示仍在跑的（或尚未带 status 的旧增量）。 */
export function runningBackgroundTaskEntries(
  tasks: Record<string, BackgroundTaskInfo>,
): [string, BackgroundTaskInfo][] {
  return Object.entries(tasks).filter(
    ([, t]) => !t.status || t.status === 'running',
  )
}

/** transcript seal 用：集合必须是 toolCallId（不是 taskId）。 */
export function backgroundToolCallIdSet(
  tasks: Record<string, BackgroundTaskInfo>,
): Set<string> {
  const s = new Set<string>()
  for (const t of Object.values(tasks)) {
    if (t.toolCallId) s.add(t.toolCallId)
  }
  return s
}
