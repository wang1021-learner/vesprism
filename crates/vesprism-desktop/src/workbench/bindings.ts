import { invoke } from '@tauri-apps/api/core'

export type WorkbenchArtifactKind = 'flow' | 'agent'

export type WorkbenchArtifactRef = {
  kind: WorkbenchArtifactKind
  id: string
  updated_at_ms?: number
}

export type WorkbenchBinding = {
  session_id: string
  active_workbench_view?: 'flow-canvas' | 'agents' | string | null
  artifacts: WorkbenchArtifactRef[]
  updated_at_ms: number
}

export async function getWorkbenchBinding(
  sessionId: string,
): Promise<WorkbenchBinding | null> {
  const id = sessionId.trim()
  if (!id) return null
  return invoke<WorkbenchBinding | null>('get_workbench_binding', { sessionId: id })
}

export type WorkbenchSessionSummary = {
  id: string
  title: string
  updated_at: string
  cwd: string
  preview?: string
  num_messages?: number
}

/** 侧栏「工作台」会话记录（画布/编制开口或已绑定产物）。 */
export async function listWorkbenchSessions(
  limit?: number,
): Promise<WorkbenchSessionSummary[]> {
  return invoke<WorkbenchSessionSummary[]>('list_workbench_sessions', {
    limit: limit ?? null,
  })
}

export async function listWorkbenchBindings(
  sessionIds: string[],
): Promise<WorkbenchBinding[]> {
  const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []
  return invoke<WorkbenchBinding[]>('list_workbench_bindings', { sessionIds: ids })
}

/** 标记会话为工具会话（flow-canvas / agents 等面板），默认不进侧栏历史。 */
export async function markToolSession(sessionId: string): Promise<void> {
  const sid = sessionId.trim()
  if (!sid) return
  await invoke('mark_tool_session', { sessionId: sid })
}

/** 取消工具会话标记（一般不需要：有产物的会话由 list_workbench_sessions 单独列出）。 */
export async function unmarkToolSession(sessionId: string): Promise<void> {
  const sid = sessionId.trim()
  if (!sid) return
  await invoke('unmark_tool_session', { sessionId: sid })
}

export const isToolSession = (sessionId: string) =>
  invoke<boolean>('is_tool_session', { sessionId })

/** 工作台第一次开口：不依赖已保存 Flow/Agent。 */
export async function touchWorkbenchSession(
  sessionId: string,
  view: 'flow-canvas' | 'agents',
  title?: string,
  cwd?: string,
): Promise<void> {
  const sid = sessionId.trim()
  if (!sid) return
  await invoke('touch_workbench_session', {
    sessionId: sid,
    view,
    title: (title || '').trim(),
    cwd: (cwd || '').trim(),
  })
}

export async function bindWorkbenchArtifact(
  sessionId: string,
  artifact: { kind: WorkbenchArtifactKind; id: string },
  activeWorkbenchView?: 'flow-canvas' | 'agents',
): Promise<WorkbenchBinding | null> {
  const sid = sessionId.trim()
  const artifactId = artifact.id.trim()
  if (!sid || !artifactId) return null
  const binding = await invoke<WorkbenchBinding | null>('bind_workbench_artifact', {
    payload: {
      session_id: sid,
      kind: artifact.kind,
      id: artifactId,
      active_workbench_view: activeWorkbenchView ?? null,
    },
  })
  window.dispatchEvent(
    new CustomEvent('vesprism:workbench-binding-changed', {
      detail: { sessionId: sid },
    }),
  )
  return binding
}
