import { getFlow, listFlows } from '../bridge'
import type { FlowListItem, FlowRecord } from '../flow'

export type AgentFlowRef = { id: string; name: string; published: boolean; record: FlowRecord }

/** 列表项已带 preset_ids 时只拉命中项，避免对每个流程 getFlow。 */
export function listItemsUsingAgent(flows: FlowListItem[], agentId: string): FlowListItem[] {
  return flows.filter((f) => (f.preset_ids ?? []).includes(agentId))
}

function nodeUsesAgent(nodes: FlowRecord['nodes'] | undefined, agentId: string): boolean {
  return Array.isArray(nodes) && nodes.some((n) => (n.params as { presetId?: string }).presetId === agentId)
}

/** 扫草稿/包节点里的 presetId。列表无 preset_ids 时回退全量 getFlow。 */
export async function findFlowsUsingAgent(agentId: string): Promise<AgentFlowRef[]> {
  const flows = await listFlows()
  const known = flows.some((f) => Array.isArray(f.preset_ids))
  const candidates = known ? listItemsUsingAgent(flows, agentId) : flows
  const found = await Promise.all(
    candidates.map(async (f) => {
      try {
        const full = await getFlow(f.id)
        if (!nodeUsesAgent(full.nodes, agentId)) return null
        return {
          id: f.id,
          name: f.name || full.name || f.id,
          published: Boolean(f.published || full.published),
          record: full,
        } satisfies AgentFlowRef
      } catch {
        return null
      }
    }),
  )
  return found.filter((x): x is AgentFlowRef => Boolean(x))
}