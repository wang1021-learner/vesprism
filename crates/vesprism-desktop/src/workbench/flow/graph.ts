/**
 * 画布图工具：demo、自动布局、依赖收集、Schema 总结。
 */
import type {
  FlowDraft,
  FlowGraphEdge,
  FlowGraphJson,
  FlowGraphNode,
  FlowGraphPatch,
  FlowNodeType,
  JsonSchema,
  SchemaField,
} from './types'
import { slugifyFlowId } from './types'
import { AI_GRAPH_FAIL_MESSAGE, validateFlowGraph } from './schema'

export const NODE_LIBRARY: { type: FlowNodeType; label: string; hint: string }[] = [
  { type: 'start', label: '起点', hint: '定义流程输入' },
  { type: 'agent', label: 'Agent', hint: '挂编制员工 / 试岗角色' },
  { type: 'tool', label: '工具', hint: '执行命令或工具调用' },
  { type: 'http', label: 'HTTP', hint: '调用外部接口（GET/POST 等）' },
  { type: 'database', label: '数据库', hint: '执行 SQL（内置 SQLite）' },
  { type: 'knowledge', label: '知识库', hint: '检索本地知识库（FTS5）' },
  { type: 'variable', label: '变量', hint: '常量或引用上游/输入' },
  { type: 'transform', label: '代码', hint: 'Rhai 表达式变换数据' },
  { type: 'loop', label: '迭代', hint: 'For-Each 遍历数组' },
  { type: 'loop_end', label: '迭代汇聚', hint: '收集循环结果' },
  { type: 'flow', label: '子流程', hint: '引用已发布流程' },
  { type: 'branch', label: '分支', hint: '按条件多路分流' },
  { type: 'parallel', label: '并行', hint: '并发执行多分支任务' },
  { type: 'join', label: '汇聚', hint: '聚合多个分支的产物' },
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
      return { label: 'Agent', role: '', presetId: '', model: '', agentType: '', prompt: '', maxOutputTokens: 0, retry: 0, timeoutSecs: 0 }
    case 'tool':
      return { label: '代办', toolName: '', command: '', args: {}, retry: 0, timeoutSecs: 0 }
    case 'http':
      return { label: 'HTTP', url: '', method: 'GET', headers: '', body: '', retry: 0, timeoutSecs: 0 }
    case 'database':
      return { label: '数据库', sql: '', dbPath: '', retry: 0 }
    case 'knowledge':
      return { label: '知识库', knowledgeBase: '', query: '', limit: 5, retry: 0 }
    case 'variable':
      return { label: '变量', value: '', valueType: 'string' }
    case 'transform':
      return { label: '代码', code: '' }
    case 'loop':
      return { label: '迭代' }
    case 'loop_end':
      return { label: '迭代汇聚' }
    case 'flow':
      return { label: '子流程', flowId: '', input: {} }
    case 'branch':
      return { label: '分支', condition: 'success', expression: '' }
    case 'parallel':
      return { label: '并行扇出', mode: 'all' }
    case 'join':
      return { label: '结果汇聚', mergeMode: 'merge_json' }
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
          role: '需求与代码分析专家',
          prompt: '请分析输入的开发需求或代码，整理出清晰的技术摘要与核心要点。',
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
  const incoming = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of graph.nodes) {
    outgoing.set(n.id, [])
    incoming.set(n.id, [])
    indeg.set(n.id, 0)
  }
  for (const e of graph.edges) {
    outgoing.get(e.from)?.push(e.to)
    incoming.get(e.to)?.push(e.from)
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
  for (const n of graph.nodes) {
    if (!layer.has(n.id)) {
      layer.set(n.id, 0)
    }
  }
  const buckets = new Map<number, string[]>()
  for (const n of graph.nodes) {
    const L = layer.get(n.id) ?? 0
    const list = buckets.get(L) ?? []
    list.push(n.id)
    buckets.set(L, list)
  }
  const maxLayerSize = Math.max(...Array.from(buckets.values()).map((l) => l.length), 1)
  const pos = new Map<string, { x: number; y: number }>()
  const sortedLayers = Array.from(buckets.keys()).sort((a, b) => a - b)
  for (const L of sortedLayers) {
    const ids = buckets.get(L)!
    const layerOffset = ((maxLayerSize - ids.length) * ROW_H) / 2
    ids.forEach((id, i) => {
      pos.set(id, {
        x: 80 + L * COL_W,
        y: 80 + layerOffset + i * ROW_H,
      })
    })
  }
  return graph.nodes.map((n) => ({
    ...n,
    position: pos.get(n.id) ?? { x: 80, y: 80 },
  }))
}

export function layoutDraft(draft: FlowDraft): FlowDraft {
  const g: FlowGraphJson = {
    nodes: draft.nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: draft.edges.map(({ from, to, label }) => ({ from, to, label })),
  }
  const laidOut = layoutGraph(g)
  const posMap = new Map(laidOut.map((n) => [n.id, n.position]))
  return {
    ...draft,
    dirty: true,
    nodes: draft.nodes.map((n) => ({
      ...n,
      position: posMap.get(n.id) ?? n.position,
    })),
  }
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

export function applyFlowPatch(
  draft: FlowDraft,
  patch: FlowGraphPatch,
): { ok: true; draft: FlowDraft } | { ok: false; error: string } {
  const removed = new Set((patch.remove_nodes ?? []).map((id) => id.trim()).filter(Boolean))
  let nodes = draft.nodes.filter((n) => !removed.has(n.id))
  let edges = draft.edges.filter((e) => !removed.has(e.from) && !removed.has(e.to))

  for (const upd of patch.update_nodes ?? []) {
    const i = nodes.findIndex((n) => n.id === upd.id)
    if (i < 0) return { ok: false, error: `patch 找不到节点 ${upd.id}` }
    nodes[i] = {
      ...nodes[i],
      params: { ...nodes[i].params, ...upd.params },
    }
  }

  const existing = new Set(nodes.map((n) => n.id))
  for (const add of patch.add_nodes ?? []) {
    if (existing.has(add.id)) return { ok: false, error: `patch 重复节点 ${add.id}` }
    existing.add(add.id)
    nodes = [...nodes, { id: add.id, type: add.type, params: add.params }]
  }

  const edgeKey = (e: { from: string; to: string }) => `${e.from}\0${e.to}`
  const drop = new Set((patch.remove_edges ?? []).map(edgeKey))
  if (drop.size) edges = edges.filter((e) => !drop.has(edgeKey(e)))

  for (const add of patch.add_edges ?? []) {
    edges = [...edges, { from: add.from, to: add.to, label: add.label }]
  }

  const checked = validateFlowGraph({
    nodes: nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: edges.map(({ from, to, label }) => (label ? { from, to, label } : { from, to })),
  })
  if (!checked.ok) return { ok: false, error: checked.error || AI_GRAPH_FAIL_MESSAGE }

  const laid = layoutGraph(checked.graph)
  const fresh = new Set((patch.add_nodes ?? []).map((n) => n.id))
  const posById = new Map(laid.map((n) => [n.id, n.position]))
  const nextNodes: FlowGraphNode[] = checked.graph.nodes.map((n) => {
    const prev = nodes.find((p) => p.id === n.id)
    const keep = prev?.position && !fresh.has(n.id)
    return {
      ...n,
      position: keep ? prev!.position : (posById.get(n.id) ?? { x: 80, y: 80 }),
    }
  })

  return {
    ok: true,
    draft: {
      ...draft,
      nodes: nextNodes,
      edges: checked.graph.edges.map((e, i) => ({
        id: `e-${e.from}-${e.to}-${i}`,
        from: e.from,
        to: e.to,
        label: e.label,
      })),
      input_schema: summarizeInputSchema(nextNodes),
      output_schema: summarizeOutputSchema(nextNodes),
      dirty: true,
    },
  }
}

export function bumpVersion(v: string): string {
  const m = v.match(/^(.*?)(\d+)([^\d]*)$/)
  if (m) {
    const nextNum = Number(m[2]) + 1
    return `${m[1]}${nextNum}${m[3]}`
  }
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
  // 子图里若有 join，把其它入边兄弟也拉进来，避免入度 < 2 校验失败。
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) {
      if (n.type !== 'join' || !seen.has(n.id)) continue
      for (const e of edges) {
        if (e.to !== n.id || seen.has(e.from)) continue
        seen.add(e.from)
        grew = true
      }
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
