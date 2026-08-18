/** 编制变更后，已发布流程的安全带过期标记（本机提示，不改包内容）。 */

import { atom } from 'nanostores'

const KEY = 'vesprism.flow-stale'

/** 编制保存 / 流程重发时 +1，画布订阅后刷新横幅。 */
export const $flowStaleEpoch = atom(0)

function bump(): void {
  $flowStaleEpoch.set($flowStaleEpoch.get() + 1)
}

export type StaleEntry = { flowId: string; flowName: string; agentId: string; at: number }

const memory: { rows: StaleEntry[] } = { rows: [] }

function store(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* 无 DOM */
  }
  return null
}

function readAll(): StaleEntry[] {
  const s = store()
  if (!s) return memory.rows
  try {
    const raw = s.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StaleEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(rows: StaleEntry[]): void {
  memory.rows = rows
  store()?.setItem(KEY, JSON.stringify(rows))
}

export function markFlowsStale(
  agentId: string,
  flows: Array<{ id: string; name: string }>,
): StaleEntry[] {
  const now = Date.now()
  const keep = readAll().filter((r) => r.agentId !== agentId)
  const next = [
    ...keep,
    ...flows.map((f) => ({ flowId: f.id, flowName: f.name, agentId, at: now })),
  ]
  writeAll(next)
  bump()
  return next.filter((r) => r.agentId === agentId)
}

export function staleForFlow(flowId: string): StaleEntry | null {
  return readAll().find((r) => r.flowId === flowId) ?? null
}

export function clearFlowStale(flowId: string): void {
  writeAll(readAll().filter((r) => r.flowId !== flowId))
  bump()
}

export function listStaleForAgent(agentId: string): StaleEntry[] {
  return readAll().filter((r) => r.agentId === agentId)
}

export function resetFlowStale(): void {
  writeAll([])
  bump()
}