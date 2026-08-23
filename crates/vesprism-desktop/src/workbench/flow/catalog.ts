/**
 * 发布/试跑只拉「引用到的」子流程，不扫全部流程列表。
 */
import type { FlowCatalog } from './inline'
import type { FlowDraft, FlowGraphEdge, FlowGraphNode } from './types'

export function referencedFlowIds(nodes: FlowGraphNode[]): string[] {
  const ids: string[] = []
  for (const n of nodes) {
    if (n.type !== 'flow') continue
    const id = String((n.params as { flowId?: string }).flowId || '').trim()
    if (id) ids.push(id)
  }
  return ids
}

export type FlowRecordLike = {
  nodes?: unknown
  edges?: unknown
}

/** 按引用 BFS 拉子流程；嵌套 flow 节点继续展开。 */
export async function loadReferencedCatalog(
  draft: FlowDraft,
  getFlow: (id: string) => Promise<FlowRecordLike>,
): Promise<{ catalog: FlowCatalog; missing: string[] }> {
  const catalog: FlowCatalog = {}
  const missing: string[] = []
  const seen = new Set<string>()
  const queue = referencedFlowIds(draft.nodes).filter((id) => id !== draft.id)
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id) || id === draft.id) continue
    seen.add(id)
    try {
      const rec = await getFlow(id)
      const nodes = Array.isArray(rec.nodes) ? (rec.nodes as FlowGraphNode[]) : []
      const edges = Array.isArray(rec.edges) ? (rec.edges as FlowGraphEdge[]) : []
      catalog[id] = { nodes, edges }
      for (const nid of referencedFlowIds(nodes)) {
        if (!seen.has(nid) && nid !== draft.id) queue.push(nid)
      }
    } catch {
      missing.push(id)
    }
  }
  return { catalog, missing }
}
