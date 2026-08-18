import { getFlow, listFlows } from '../bridge'
import type { FlowRecord } from '../flow'

export type AgentFlowRef = { id: string; name: string; published: boolean; record: FlowRecord }

/** 扫草稿/包节点里的 presetId。已发布但 nodes 空的包会漏掉，调用方应再提示。 */
export async function findFlowsUsingAgent(agentId: string): Promise<AgentFlowRef[]> {
  const flows = await listFlows()
  const out: AgentFlowRef[] = []
  for (const f of flows) {
    try {
      const full = await getFlow(f.id)
      const hit = Array.isArray(full.nodes)
        && full.nodes.some((n) => (n.params as { presetId?: string }).presetId === agentId)
      if (hit) {
        out.push({
          id: f.id,
          name: f.name || full.name || f.id,
          published: Boolean(f.published || full.published),
          record: full,
        })
      }
    } catch {
      /* 单项失败不挡整表 */
    }
  }
  return out
}