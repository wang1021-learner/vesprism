/**
 * 画布图工具：demo、自动布局、依赖收集、Schema 总结。
 */
import type {
  FlowDraft,
  FlowGraphEdge,
  FlowGraphJson,
  FlowGraphNode,
  FlowNodeType,
  JsonSchema,
  SchemaField,
} from './types'
import { slugifyFlowId } from './types'

export const NODE_LIBRARY: { type: FlowNodeType; label: string; hint: string }[] = [
  { type: 'start', label: '起点', hint: '定义流程输入' },
  { type: 'agent', label: 'Agent', hint: '挂组装单 / 角色' },
  { type: 'tool', label: '工具', hint: '调用工具或命令' },
  { type: 'flow', label: '子流程', hint: '引用已发布流程' },
  { type: 'branch', label: '分支', hint: '按条件分流' },
  { type: 'end', label: '终点', hint: '定义流程输出' },
]

const COL_W = 240
const ROW_H = 140

export function createNodeId(type: FlowNodeType): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${type}-${rand}`
}

export function defaultParams(type: FlowNodeType): FlowGraphNode['params'] {
  switch (type) {
    case 'start':
      return { label: '起点', fields: [{ name: 'input', type: 'string', required: true }] }
    case 'agent':
      return { label: 'Agent', role: '', presetId: '', model: '', agentType: '', prompt: '' }
    case 'tool':
      return { label: '工具', toolName: '', command: '', args: {} }
    case 'flow':
      return { label: '子流程', flowId: '', input: {} }
    case 'branch':
      return { label: '分支', condition: 'success', expression: '' }
    case 'end':
      return { label: '终点', outputSchema: { type: 'object' } }
  }
}

/** 三节点线性 demo：start → agent → end */
export function createDemoDraft(): FlowDraft {
  const startId = 'start-1'
  const agentId = 'agent-1'
  const endId = 'end-1'
  return {
    id: 'demo-linear',
    name: '示例流程',
    description: '',
    version: '1',
    input_schema: fieldsToSchema([{ name: 'input', type: 'string', required: true }]),
    output_schema: { type: 'object' },
    dirty: false,
    published: false,
    nodes: [
      {
        id: startId,
        type: 'start',
        position: { x: 80, y: 180 },
        params: { label: '起点', fields: [{ name: 'input', type: 'string', required: true }] },
      },
      {
        id: agentId,
        type: 'agent',
        position: { x: 360, y: 160 },
        params: {
          label: '摘要',
          role: '把输入整理成一段简洁摘要',
          prompt: '请将用户输入整理成不超过 80 字的中文摘要，只输出摘要。',
        },
      },
      {
        id: endId,
        type: 'end',
        position: { x: 640, y: 180 },
        params: { label: '终点', outputSchema: { type: 'object' } },
      },
    ],
    edges: [
      { id: 'e-start-agent', from: startId, to: agentId },
      { id: 'e-agent-end', from: agentId, to: endId },
    ],
  }
}

export function fieldsToSchema(fields: SchemaField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const f of fields) {
    if (!f.name.trim()) continue
    properties[f.name] = { type: f.type }
    if (f.description) properties[f.name].description = f.description
    if (f.required !== false) required.push(f.name)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
  }
}

export function summarizeInputSchema(nodes: FlowGraphNode[]): JsonSchema {
  const start = nodes.find((n) => n.type === 'start')
  if (!start) return { type: 'object' }
  const p = start.params as { fields?: SchemaField[]; inputSchema?: JsonSchema }
  if (p.inputSchema && typeof p.inputSchema === 'object') return p.inputSchema
  return fieldsToSchema(p.fields ?? [])
}

export function summarizeOutputSchema(nodes: FlowGraphNode[]): JsonSchema {
  const end = nodes.find((n) => n.type === 'end')
  if (!end) return { type: 'object' }
  const p = end.params as { outputSchema?: JsonSchema }
  return p.outputSchema && typeof p.outputSchema === 'object' ? p.outputSchema : { type: 'object' }
}

export function collectDependencies(nodes: FlowGraphNode[]): string[] {
  const ids = new Set<string>()
  for (const n of nodes) {
    if (n.type !== 'flow') continue
    const id = String((n.params as { flowId?: string }).flowId ?? '').trim()
    if (id) ids.add(id)
  }
  return Array.from(ids).sort()
}

/** 按拓扑分层自动排坐标（AI 生成图 / 导入无坐标时使用） */
export function layoutGraph(graph: FlowGraphJson): FlowGraphNode[] {
  const outgoing = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of graph.nodes) {
    outgoing.set(n.id, [])
    indeg.set(n.id, 0)
  }
  for (const e of graph.edges) {
    outgoing.get(e.from)?.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }
  const layer = new Map<string, number>()
  const queue: string[] = []
  for (const n of graph.nodes) {
    if ((indeg.get(n.id) ?? 0) === 0) {
      queue.push(n.id)
      layer.set(n.id, 0)
    }
  }
  while (queue.length) {
    const id = queue.shift()!
    const d = layer.get(id) ?? 0
    for (const nxt of outgoing.get(id) ?? []) {
      const nextLayer = Math.max(layer.get(nxt) ?? 0, d + 1)
      layer.set(nxt, nextLayer)
      const left = (indeg.get(nxt) ?? 1) - 1
      indeg.set(nxt, left)
      if (left === 0) queue.push(nxt)
    }
  }
  const buckets = new Map<number, string[]>()
  for (const n of graph.nodes) {
    const L = layer.get(n.id) ?? 0
    const list = buckets.get(L) ?? []
    list.push(n.id)
    buckets.set(L, list)
  }
  const pos = new Map<string, { x: number; y: number }>()
  for (const [L, ids] of buckets) {
    ids.forEach((id, i) => {
      pos.set(id, { x: 80 + L * COL_W, y: 80 + i * ROW_H })
    })
  }
  return graph.nodes.map((n) => ({
    ...n,
    position: pos.get(n.id) ?? { x: 80, y: 80 },
  }))
}

export function graphJsonFromDraft(draft: FlowDraft): FlowGraphJson {
  return {
    nodes: draft.nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: draft.edges.map(({ from, to, label }) => (label ? { from, to, label } : { from, to })),
  }
}

export function draftFromGraph(
  graph: FlowGraphJson,
  meta: { id?: string; name?: string; description?: string; version?: string },
): FlowDraft {
  const nodes = layoutGraph(graph)
  const name = meta.name?.trim() || '未命名流程'
  return {
    id: meta.id && meta.id.trim() ? meta.id : slugifyFlowId(name),
    name,
    description: meta.description ?? '',
    version: meta.version ?? '1',
    input_schema: summarizeInputSchema(nodes),
    output_schema: summarizeOutputSchema(nodes),
    nodes,
    edges: graph.edges.map((e, i) => ({
      id: `e-${e.from}-${e.to}-${i}`,
      from: e.from,
      to: e.to,
      label: e.label,
    })),
    dirty: true,
    published: false,
  }
}

export function bumpVersion(v: string): string {
  const n = Number.parseInt(v, 10)
  if (Number.isFinite(n) && n >= 0) return String(n + 1)
  const m = v.match(/(\d+)(?!.*\d)/)
  if (m) return v.slice(0, m.index) + String(Number(m[1]) + 1)
  return '1'
}

export function nodeLabel(n: FlowGraphNode): string {
  const label = String((n.params as { label?: string }).label ?? '').trim()
  if (label) return label
  return NODE_LIBRARY.find((x) => x.type === n.type)?.label ?? n.type
}

export function nextEdgesFrom(edges: FlowGraphEdge[], nodeId: string): FlowGraphEdge[] {
  return edges.filter((e) => e.from === nodeId)
}

export function subgraphFrom(
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
  startId: string,
): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] } {
  const seen = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of edges) {
      if (e.from !== id || seen.has(e.to)) continue
      seen.add(e.to)
      queue.push(e.to)
    }
  }
  return {
    nodes: nodes.filter((n) => seen.has(n.id)),
    edges: edges.filter((e) => seen.has(e.from) && seen.has(e.to)),
  }
}

const ABS_PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|Users|usr|var|opt|tmp)\b)/

export function textHasAbsolutePath(text: string): boolean {
  return ABS_PATH_RE.test(text)
}

export function draftHasAbsolutePath(draft: FlowDraft): string | null {
  const blob = JSON.stringify({
    nodes: draft.nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: draft.edges,
    description: draft.description,
  })
  return textHasAbsolutePath(blob) ? '流程内容含绝对路径，发布/导出前请改为相对路径或 id 引用' : null
}
