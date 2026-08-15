/**
 * AI 生成图契约：严格校验。非法则整体拒绝，绝不半渲染。
 */
import {
  FLOW_NODE_TYPES,
  type FlowGraphJson,
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

/** 从模型输出文本中抽出 JSON 对象（```json 围栏或首个大括号）。 */
export function extractJsonObject(text: string): unknown | null {
  const raw = (text || '').trim()
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * 严格校验 AI / 导入 graph。
 * 约束：nodes/edges 形状、type 六选一、连线端点存在、至少各一个 start/end、
 * 每个 branch 至少一条出边。
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
  }

  for (const n of nodes) {
    if (n.type === 'branch' && (outCount.get(n.id) ?? 0) < 1) {
      return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
    }
  }

  return { ok: true, graph: { nodes, edges } }
}

/** 解析模型回复：抽 JSON + 严格校验。失败统一文案。 */
export function parseGeneratedGraph(text: string): SchemaResult {
  const parsed = extractJsonObject(text)
  if (parsed == null) return { ok: false, error: AI_GRAPH_FAIL_MESSAGE }
  return validateFlowGraph(parsed)
}
