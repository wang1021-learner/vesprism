/**
 * 草稿落盘辅助。发布 sidecar 由 Rust `flow_compile` 编译，前端不再把 rhai 送去 save_flow。
 * `compileDraftRhai` 只给测试和预览对照用，不走写盘。
 */
import { AGENT_CAPABILITY_OFFICIAL, type AgentListItem } from '../types'
import {
  compileCacheKey,
  compileInlinedRhai,
  compileToRhai,
  loadReferencedCatalog,
  saveHash,
  type FlowDraft,
  type FlowRecord,
  type PresetResolve,
} from '../flow'

export const DEMO_FLOW_ID = 'demo-linear'

export function shouldSkipDraftPersist(
  id: string,
  extra?: { publish?: boolean; stage?: boolean; ephemeral?: boolean },
): boolean {
  return id === DEMO_FLOW_ID && !extra?.publish && !extra?.stage && !extra?.ephemeral
}

/** 保存完成后的 dirty：按内容哈希，不按 nodes 数组引用（fromRf 每次都是新数组）。 */
export function draftAfterPersist(
  prev: FlowDraft,
  persisted: FlowDraft,
  saved: { published?: boolean; version: string },
  liveHash: string,
): FlowDraft {
  if (prev.id !== persisted.id) return prev
  const same = liveHash === saveHash(persisted)
  return {
    ...prev,
    dirty: prev.dirty && !same,
    published: saved.published ?? prev.published,
    version: saved.version || prev.version,
  }
}

let writeTail: Promise<void> = Promise.resolve()

/** 草稿写入串行，避免卸载 flush 与重挂载 getFlow 抢跑。 */
export function enqueueFlowWrite<T>(job: () => Promise<T>): Promise<T> {
  const run = writeTail.then(job, job)
  writeTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function pendingFlowWrites(): Promise<void> {
  return writeTail
}

export function resetFlowWriteQueueForTests(): void {
  writeTail = Promise.resolve()
}

export function presetsFromAgentList(agents: AgentListItem[]): Record<string, PresetResolve> {
  const presets: Record<string, PresetResolve> = {}
  for (const a of agents) {
    if (a.error) continue
    const systemPrompt = (a.systemPrompt || a.system_prompt || '').trim()
    presets[a.id] = {
      name: a.name || a.id,
      description: a.description || undefined,
      systemPrompt: systemPrompt || undefined,
      model: a.model || undefined,
      agentType: (a.agentType || a.agent_type) || undefined,
      capability: a.capability ? AGENT_CAPABILITY_OFFICIAL[a.capability] : undefined,
      isolation: a.isolation,
      outputSchema: (a.outputSchema ?? a.output_schema) ?? undefined,
      disabledTools: (a.disabledTools ?? a.disabled_tools) ?? [],
      permissionRules: (a.permissionRules ?? a.permission_rules) ?? [],
      skills: a.skills || [],
    }
  }
  return presets
}

export async function compileDraftRhai(
  d: FlowDraft,
  getFlow: (id: string) => Promise<Pick<FlowRecord, 'nodes' | 'edges'>>,
  listAgents: () => Promise<AgentListItem[]>,
  cache: { current: { key: string; rhai: string } | null },
): Promise<string> {
  const { catalog, missing } = await loadReferencedCatalog(d, getFlow)
  if (missing.length) {
    throw new Error(`缺少子流程：${missing.join('、')}`)
  }
  let presets: Record<string, PresetResolve> = {}
  try {
    presets = presetsFromAgentList(await listAgents())
  } catch {
    /* 编制列表失败时仍编图，节点人设走本地 params */
  }
  const key = compileCacheKey(d, { presets, catalog })
  if (cache.current?.key === key) return cache.current.rhai
  const compiled = compileInlinedRhai(d, catalog, (next) => compileToRhai(next, { presets }))
  if (!compiled.ok) throw new Error(compiled.error)
  cache.current = { key, rhai: compiled.rhai }
  return compiled.rhai
}
