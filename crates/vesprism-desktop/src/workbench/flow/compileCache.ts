/** 画布保存/编译/撤销：哈希比对 + 瘦快照，避免全量深拷贝和重复编 Rhai。 */

import type { FlowDraft, FlowGraphEdge, FlowGraphNode, JsonSchema } from './types'

export type GraphSnap = {
  name: string
  description: string
  version: string
  input_schema: JsonSchema
  output_schema: JsonSchema
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
}

export type TopologyDraft = Pick<
  FlowDraft,
  'id' | 'name' | 'description' | 'version' | 'nodes' | 'edges' | 'input_schema' | 'output_schema'
>

/** 拓扑 + params + 元信息（不含坐标）。发布/试跑编 Rhai 用。 */
export function topologyHash(d: TopologyDraft): string {
  return JSON.stringify({
    id: d.id,
    name: d.name,
    desc: d.description,
    ver: d.version,
    in: d.input_schema,
    out: d.output_schema,
    nodes: d.nodes.map((n) => [n.id, n.type, n.params]),
    edges: d.edges.map((e) => [e.from, e.to, e.label ?? '', e.sourceHandle ?? '', e.targetHandle ?? '']),
  })
}

/** 编 Rhai 缓存键：拓扑/元信息 + Agent 编制 + 已内联子流程。 */
export function compileCacheKey(
  d: TopologyDraft,
  extras: { presets: unknown; catalog?: unknown },
): string {
  return `${topologyHash(d)}\0${JSON.stringify({
    presets: extras.presets,
    catalog: extras.catalog ?? null,
  })}`
}

/** 含坐标与标题，自动保存去重用。 */
export function saveHash(d: FlowDraft): string {
  return `${topologyHash(d)}\0${JSON.stringify({
    name: d.name,
    desc: d.description,
    ver: d.version,
    pos: d.nodes.map((n) => [n.id, n.position?.x ?? 0, n.position?.y ?? 0]),
  })}`
}

export function takeSnap(d: FlowDraft): GraphSnap {
  return {
    name: d.name,
    description: d.description,
    version: d.version,
    input_schema: d.input_schema,
    output_schema: d.output_schema,
    nodes: d.nodes,
    edges: d.edges,
  }
}

export function applySnap(base: FlowDraft, snap: GraphSnap): FlowDraft {
  return {
    ...base,
    name: snap.name,
    description: snap.description,
    version: snap.version,
    input_schema: snap.input_schema,
    output_schema: snap.output_schema,
    nodes: snap.nodes,
    edges: snap.edges,
    dirty: true,
  }
}

export function historyCap(nodeCount: number): number {
  if (nodeCount >= 200) return 8
  if (nodeCount >= 80) return 16
  return 30
}

export function pushCapped<T>(stack: T[], item: T, cap: number): void {
  stack.push(item)
  while (stack.length > cap) stack.shift()
}
