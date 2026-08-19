/**
 * AI 生成图契约：严格校验。非法则整体拒绝，绝不半渲染。
 */
import {
  FLOW_NODE_TYPES,
  type FlowGraphJson,
  type FlowGraphPatch,
  type FlowNodeParams,
  type FlowNodeType,
} from './types'

export const AI_GRAPH_FAIL_MESSAGE = '生成失败，请重试'

export type SchemaOk = { ok: true; graph: FlowGraphJson }
export type SchemaErr = { ok: false; error: string }
export type SchemaResult = SchemaOk | SchemaErr

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNodeType(v: unknown): v is FlowNodeType {
  return typeof v === 'string' && (FLOW_NODE_TYPES as readonly string[]).includes(v)
}

function asParams(v: unknown): FlowNodeParams {
  return isRecord(v) ? (v as FlowNodeParams) : {}
}

/** 从模型输出文本中抽出 JSON 对象（容错清理 + 括号平衡深度扫描器）。 */
export function extractJsonObject(text: string): unknown | null {
  const raw = (text || '').trim()
  if (!raw) return null

  // 1. 优先提取 ```json ... ``` 围栏中的内容
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()

  // 2. 尝试直接解析
  try {
    return JSON.parse(candidate)
  } catch {
    /* 尝试容错与深度提取 */
  }

  // 3. 括号平衡扫描器：找到首个 '{' 并向后匹配完整的闭合 '}'
  const start = candidate.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  let matchEnd = -1

  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
        if (depth === 0) {
          matchEnd = i
          break
        }
      }
    }
  }

  if (matchEnd <= start) return null

  let jsonStr = candidate.slice(start, matchEnd + 1)

  // 4. 容错修复：清除常见的尾随逗号 `,}` 或 `,]`
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')

  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

function expectedOutDegree(type: FlowNodeType): { min: number; max: number } {
  switch (type) {
    case 'end':
      return { min: 0, max: 0 }
    case 'branch':
      return { min: 2, max: 20 }
    case 'parallel':
      return { min: 2, max: 20 }
    case 'join':
      return { min: 1, max: 1 }
    default:
      return { min: 1, max: 1 }
  }
}

/**
 * 严格校验 AI / 导入 / 发布 graph。
 * 约束：nodes/edges 形状、type 八选一、连线端点存在、至少各一个 start/end、
 * 支持 parallel 扇出、join 汇聚、多路 branch 路由。
 */
export function validateFlowGraph(input: unknown): SchemaResult {
  if (!isRecord(input)) {
    return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
  }

  const ids = new Set<string>()
  const nodes: FlowGraphJson['nodes'] = []
  let starts = 0
  let ends = 0

  for (const item of input.nodes) {
    if (!isRecord(item)) return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || ids.has(id) || !isNodeType(item.type)) {
      return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    }
    ids.add(id)
    if (item.type === 'start') starts += 1
    if (item.type === 'end') ends += 1
    nodes.push({ id, type: item.type, params: asParams(item.params) })
  }

  if (starts < 1 || ends < 1) {
    return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
  }

  const outCount = new Map<string, number>()
  const inCount = new Map<string, number>()
  const edges: FlowGraphJson['edges'] = []
  for (const item of input.edges) {
    if (!isRecord(item)) return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    const from = typeof item.from === 'string' ? item.from.trim() : ''
    const to = typeof item.to === 'string' ? item.to.trim() : ''
    if (!from || !to || !ids.has(from) || !ids.has(to) || from === to) {
      return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    }
    const label = typeof item.label === 'string' ? item.label : undefined
    edges.push(label ? { from, to, label } : { from, to })
    outCount.set(from, (outCount.get(from) ?? 0) + 1)
    inCount.set(to, (inCount.get(to) ?? 0) + 1)
  }

  for (const n of nodes) {
    const { min, max } = expectedOutDegree(n.type)
    const count = outCount.get(n.id) ?? 0
    if (count < min || count > max) {
      return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    }
    if (n.type === 'join') {
      const inDegree = inCount.get(n.id) ?? 0
      if (inDegree < 2) {
        return { ok: false, error: '汇聚节点 (join) 至少需要 2 条输入边' }
      }
    }
    if (n.type === 'parallel') {
      const branchEdges = edges.filter((e) => e.from === n.id)
      for (const bEdge of branchEdges) {
        const targetNode = nodes.find((x) => x.id === bEdge.to)
        if (!targetNode || (targetNode.type !== 'agent' && targetNode.type !== 'tool')) {
          return {
            ok: false,
            error: `并行节点 (${n.id}) 的直接分支必须为单一 Agent 或工具任务节点（当前 ${bEdge.to} 为 ${targetNode?.type || '未知'}）`,
          }
        }
        const targetOutEdges = edges.filter((e) => e.from === targetNode.id)
        for (const toEdge of targetOutEdges) {
          const downNode = nodes.find((x) => x.id === toEdge.to)
          if (downNode && downNode.type !== 'join' && downNode.type !== 'end') {
            return {
              ok: false,
              error: `并行分支 (${targetNode.id}) 需直接连入汇聚网关 (join) 或结束节点，不支持嵌套串行子链；如需多步组合请封装为子流程。`,
            }
          }
        }
      }
    }
  }

  const dagErr = findDagErrors(nodes, edges)
  if (dagErr) return { ok: false, error: dagErr }

  return { ok: true, graph: { nodes, edges } }
}

function findDagErrors(
  nodes: FlowGraphJson['nodes'],
  edges: FlowGraphJson['edges'],
): string | null {
  const outgoing = new Map<string, string[]>()
  for (const n of nodes) outgoing.set(n.id, [])
  for (const e of edges) outgoing.get(e.from)?.push(e.to)

  const starts = nodes.filter((n) => n.type === 'start').map((n) => n.id)
  const ends = new Set(nodes.filter((n) => n.type === 'end').map((n) => n.id))
  const seen = new Set<string>()
  const stack = [...starts]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const nxt of outgoing.get(id) ?? []) stack.push(nxt)
  }
  const orphan = nodes.find((n) => !seen.has(n.id))
  if (orphan) return `孤岛节点：${orphan.id} 无法从 start 到达`

  const visiting = new Set<string>()
  const done = new Set<string>()
  const cycleFrom = (id: string): string | null => {
    if (done.has(id)) return null
    if (visiting.has(id)) return `图中存在环（途经 ${id}），必须是 DAG`
    visiting.add(id)
    for (const nxt of outgoing.get(id) ?? []) {
      const hit = cycleFrom(nxt)
      if (hit) return hit
    }
    visiting.delete(id)
    done.add(id)
    return null
  }
  for (const s of starts) {
    const hit = cycleFrom(s)
    if (hit) return hit
  }

  const canReachEnd = new Set<string>()
  const walkEnd = (id: string): boolean => {
    if (canReachEnd.has(id)) return true
    if (ends.has(id)) {
      canReachEnd.add(id)
      return true
    }
    let ok = false
    for (const nxt of outgoing.get(id) ?? []) {
      if (walkEnd(nxt)) ok = true
    }
    if (ok) canReachEnd.add(id)
    return ok
  }
  for (const s of starts) walkEnd(s)
  const dead = nodes.find((n) => seen.has(n.id) && !canReachEnd.has(n.id))
  if (dead) return `节点 ${dead.id} 无法走到 end`

  return null
}

/** 解析模型回复：抽 JSON + 严格校验。失败统一文案。 */
export function parseGeneratedGraph(text: string): SchemaResult {
  const parsed = extractJsonObject(text)
  if (parsed == null) return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
  return validateFlowGraph(parsed)
}

export type CanvasModelOk =
  | { ok: true; kind: 'graph'; graph: FlowGraphJson }
  | { ok: true; kind: 'patch'; patch: FlowGraphPatch }
export type CanvasModelResult = CanvasModelOk | SchemaErr

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
}

function parsePatch(raw: unknown): FlowGraphPatch | null {
  if (!isRecord(raw)) return null
  const src = isRecord(raw.patch) ? raw.patch : raw
  const patch: FlowGraphPatch = {}
  if (Array.isArray(src.update_nodes)) {
    const update_nodes: NonNullable<FlowGraphPatch['update_nodes']> = []
    for (const item of src.update_nodes) {
      if (!isRecord(item)) return null
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!id || !isRecord(item.params)) return null
      update_nodes.push({ id, params: item.params })
    }
    patch.update_nodes = update_nodes
  }
  if (Array.isArray(src.add_nodes)) {
    const add_nodes: NonNullable<FlowGraphPatch['add_nodes']> = []
    for (const item of src.add_nodes) {
      if (!isRecord(item)) return null
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!id || !isNodeType(item.type)) return null
      add_nodes.push({ id, type: item.type, params: asParams(item.params) })
    }
    patch.add_nodes = add_nodes
  }
  const remove_nodes = asStringList(src.remove_nodes)
  if (remove_nodes) patch.remove_nodes = remove_nodes
  if (Array.isArray(src.add_edges)) {
    const add_edges: NonNullable<FlowGraphPatch['add_edges']> = []
    for (const item of src.add_edges) {
      if (!isRecord(item)) return null
      const from = typeof item.from === 'string' ? item.from.trim() : ''
      const to = typeof item.to === 'string' ? item.to.trim() : ''
      if (!from || !to) return null
      const label = typeof item.label === 'string' ? item.label : undefined
      add_edges.push(label ? { from, to, label } : { from, to })
    }
    patch.add_edges = add_edges
  }
  if (Array.isArray(src.remove_edges)) {
    const remove_edges: NonNullable<FlowGraphPatch['remove_edges']> = []
    for (const item of src.remove_edges) {
      if (!isRecord(item)) return null
      const from = typeof item.from === 'string' ? item.from.trim() : ''
      const to = typeof item.to === 'string' ? item.to.trim() : ''
      if (!from || !to) return null
      remove_edges.push({ from, to })
    }
    patch.remove_edges = remove_edges
  }
  const keys = Object.keys(patch)
  return keys.length > 0 ? patch : null
}

export function looksLikeCanvasGraphJson(text: string): boolean {
  const t = text || ''
  return (
    /```(?:json)?\s*\{/i.test(t) ||
    (t.includes('"nodes"') && t.includes('"edges"')) ||
    t.includes('"patch"') ||
    t.includes('"update_nodes"') ||
    t.includes('"add_nodes"')
  )
}

/** 全量图或局部 patch。含 patch 键时优先当 patch，避免和带 nodes 的混图打架。 */
export function parseCanvasModelOutput(text: string): CanvasModelResult {
  const parsed = extractJsonObject(text)
  if (parsed == null) return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
  if (isRecord(parsed) && (isRecord(parsed.patch) || parsed.update_nodes || parsed.add_nodes || parsed.remove_nodes)) {
    const patch = parsePatch(parsed)
    if (!patch) return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    return { ok: true, kind: 'patch', patch }
  }
  const graph = validateFlowGraph(parsed)
  if (!graph.ok) return graph
  return { ok: true, kind: 'graph', graph: graph.graph }
}
