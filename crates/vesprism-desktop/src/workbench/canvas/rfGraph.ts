/**
 * React Flow 节点/边 ↔ 流程草稿。执行态字段进 data，写回前走 stripRfRuntime。
 */
import {
  displayBranchLabel,
  layoutGraph,
  persistEdgeLabel,
  persistSourceHandle,
  saveHash,
  type FlowDraft,
  type FlowGraphNode,
  type FlowNodeType,
} from '../flow'
import type { Edge, Node } from '@xyflow/react'
import type { AgentListItem } from '../types'
import type { FlowRfData } from './nodes'
import { stripRfRuntime } from './rfRuntime'

export type RfNode = Node<FlowRfData>
export type RfEdge = Edge

export function getAncestors(targetId: string, edges: Array<{ from: string; to: string }>): Set<string> {
  const ancestors = new Set<string>()
  const queue = [targetId]
  while (queue.length > 0) {
    const curr = queue.shift()!
    const incoming = edges.filter((e) => e.to === curr)
    for (const edge of incoming) {
      if (!ancestors.has(edge.from)) {
        ancestors.add(edge.from)
        queue.push(edge.from)
      }
    }
  }
  return ancestors
}

export function execStatusOf(
  step?: { status: string },
): 'running' | 'done' | 'failed' | undefined {
  const raw = step?.status
  if (raw === 'completed' || raw === 'done') return 'done'
  if (raw === 'running') return 'running'
  if (raw === 'failed') return 'failed'
  return undefined
}

export function ensurePositions(nodes: FlowDraft['nodes'], edges: FlowDraft['edges']): FlowDraft['nodes'] {
  if (nodes.every((n) => n.position)) return nodes
  return layoutGraph({
    nodes: nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: edges.map(({ from, to, label }) => ({ from, to, label })),
  })
}

export function toRfNodes(
  draft: FlowDraft,
  stepOutputs?: Record<string, { output: unknown; status: string; timestamp: number }>,
): RfNode[] {
  return ensurePositions(draft.nodes, draft.edges).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 80, y: 80 },
    data: {
      ...n.params,
      nodeType: n.type,
      execStatus: execStatusOf(stepOutputs?.[n.id]),
    },
  }))
}

export function patchExecStatuses(
  ns: RfNode[],
  stepOutputs: Record<string, { output: unknown; status: string; timestamp: number }>,
): RfNode[] {
  let changed = false
  const next = ns.map((n) => {
    const status = execStatusOf(stepOutputs[n.id])
    if (n.data.execStatus === status) return n
    changed = true
    return { ...n, data: { ...n.data, execStatus: status } }
  })
  return changed ? next : ns
}

export function toRfEdges(draft: FlowDraft): RfEdge[] {
  return draft.edges.map((e, idx) => {
    const edgeLabel = displayBranchLabel(e.sourceHandle, e.label)
    return {
      id: e.id || `e-${e.from}-${e.to}-${idx}`,
      source: e.from,
      target: e.to,
      label: edgeLabel,
      labelStyle: { fill: '#4b5563', fontSize: 10.5, fontWeight: 550 },
      labelBgStyle: { fill: '#ffffff', stroke: '#e5e7eb', strokeWidth: 1, rx: 4, ry: 4 },
      labelBgPadding: [5, 2] as [number, number],
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      animated: false,
    }
  })
}

export function fromRf(ns: RfNode[], es: RfEdge[], base: FlowDraft): FlowDraft {
  const nodes: FlowGraphNode[] = ns.map((n) => {
    const raw = n.data as FlowRfData
    const params = stripRfRuntime(raw as Record<string, unknown>)
    return {
      id: n.id,
      type: raw.nodeType,
      params,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    }
  })
  const edges = es.map((e) => {
    const rawLabel = typeof e.label === 'string' ? e.label : undefined
    return {
      id: e.id,
      from: e.source,
      to: e.target,
      label: persistEdgeLabel(e.sourceHandle, rawLabel),
      sourceHandle: persistSourceHandle(e.sourceHandle, rawLabel),
      targetHandle: e.targetHandle ?? undefined,
    }
  })
  const next: FlowDraft = { ...base, nodes, edges }
  const dirty = Boolean(base.dirty) || saveHash(next) !== saveHash(base)
  return { ...next, dirty }
}

export function testKey(flowId: string): string {
  return `vesprism.flow-test-input.${flowId}`
}

export function agentNodeData(a: AgentListItem): FlowRfData {
  return {
    nodeType: 'agent' as FlowNodeType,
    label: a.name || a.id,
    presetId: a.id,
    model: a.model,
    prompt: '',
    role: '',
  }
}
