/**
 * 发布时把 flow 节点内联成一份自包含图。v1 不嵌套 flow__。
 */
import type { FlowDraft, FlowGraphEdge, FlowGraphNode } from './types'

export type FlowCatalog = Record<
  string,
  { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] }
>

export type InlineOk = { ok: true; draft: FlowDraft }
export type InlineErr = { ok: false; error: string }
export type InlineResult = InlineOk | InlineErr

function remapInnerId(
  id: string,
  prefix: string,
  startIds: Set<string>,
  endIds: Set<string>,
): string | null {
  if (startIds.has(id) || endIds.has(id)) return null
  return prefix + id
}

function replaceFlowNode(
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
  fn: FlowGraphNode,
  inner: { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] },
): { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] } {
  const startIds = new Set(inner.nodes.filter((n) => n.type === 'start').map((n) => n.id))
  const endIds = new Set(inner.nodes.filter((n) => n.type === 'end').map((n) => n.id))
  const prefix = `${fn.id}__`
  const body = inner.nodes
    .filter((n) => n.type !== 'start' && n.type !== 'end')
    .map((n) => ({ ...n, id: prefix + n.id, position: undefined }))

  const mid: FlowGraphEdge[] = []
  for (const e of inner.edges) {
    const from = remapInnerId(e.from, prefix, startIds, endIds)
    const to = remapInnerId(e.to, prefix, startIds, endIds)
    if (!from || !to) continue
    mid.push({ ...e, id: e.id ? prefix + e.id : undefined, from, to })
  }

  const incoming = edges.filter((e) => e.to === fn.id)
  const outgoing = edges.filter((e) => e.from === fn.id)
  const entryTargets: string[] = []
  for (const e of inner.edges.filter((edge) => startIds.has(edge.from))) {
    const to = remapInnerId(e.to, prefix, startIds, endIds)
    if (to) entryTargets.push(to)
  }
  if (entryTargets.length === 0) {
    const midTargets = new Set(mid.map((e) => e.to))
    const roots = body.filter((n) => !midTargets.has(n.id))
    entryTargets.push(...(roots.length ? roots : body).map((n) => n.id))
  }

  const exitSources: string[] = []
  for (const e of inner.edges.filter((edge) => endIds.has(edge.to))) {
    const from = remapInnerId(e.from, prefix, startIds, endIds)
    if (from) exitSources.push(from)
  }
  if (exitSources.length === 0) {
    const midSources = new Set(mid.map((e) => e.from))
    const leaves = body.filter((n) => !midSources.has(n.id))
    exitSources.push(...(leaves.length ? leaves : body).map((n) => n.id))
  }

  const spliced: FlowGraphEdge[] = [...mid]
  if (body.length === 0) {
    for (const inc of incoming) {
      for (const out of outgoing) {
        spliced.push({ from: inc.from, to: out.to, label: inc.label || out.label })
      }
    }
  } else {
    for (const inc of incoming) {
      if (entryTargets.length === 0) {
        for (const out of outgoing) {
          spliced.push({ from: inc.from, to: out.to, label: inc.label || out.label })
        }
      } else {
        for (const t of entryTargets) {
          spliced.push({ from: inc.from, to: t, label: inc.label })
        }
      }
    }
    for (const src of exitSources) {
      for (const out of outgoing) {
        spliced.push({ from: src, to: out.to, label: out.label })
      }
    }
  }

  return {
    nodes: [...nodes.filter((n) => n.id !== fn.id), ...body],
    edges: [...edges.filter((e) => e.from !== fn.id && e.to !== fn.id), ...spliced],
  }
}

/** 把 draft 里所有 flow 节点替换成被引用图的主体（去掉对方 start/end）。 */
export function inlineFlowNodes(
  draft: FlowDraft,
  catalog: FlowCatalog,
  visiting: string[] = [],
): InlineResult {
  if (visiting.includes(draft.id)) {
    return { ok: false, error: `子流程循环引用：${[...visiting, draft.id].join(' → ')}` }
  }
  const flowNodes = draft.nodes.filter((n) => n.type === 'flow')
  if (flowNodes.length === 0) {
    return { ok: true, draft }
  }

  let nodes = [...draft.nodes]
  let edges = [...draft.edges]
  for (const fn of flowNodes) {
    if (!nodes.some((n) => n.id === fn.id)) continue
    const flowId = String((fn.params as { flowId?: string }).flowId ?? '').trim()
    if (!flowId) {
      return { ok: false, error: `节点 ${fn.id} 未填写子流程 id` }
    }
    const src = catalog[flowId]
    if (!src || src.nodes.length === 0) {
      return {
        ok: false,
        error: `无法内联「${flowId}」：找不到画布图（请先打开并保存该流程）`,
      }
    }
    const innerDraft: FlowDraft = {
      id: flowId,
      name: flowId,
      description: '',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: src.nodes,
      edges: src.edges,
    }
    const inlined = inlineFlowNodes(innerDraft, catalog, [...visiting, draft.id])
    if (!inlined.ok) return inlined
    const next = replaceFlowNode(nodes, edges, fn, {
      nodes: inlined.draft.nodes,
      edges: inlined.draft.edges,
    })
    nodes = next.nodes
    edges = next.edges
  }

  return { ok: true, draft: { ...draft, nodes, edges } }
}

export function compileInlinedRhai(
  draft: FlowDraft,
  catalog: FlowCatalog,
  compile: (d: FlowDraft) => string,
): { ok: true; rhai: string } | InlineErr {
  const inlined = inlineFlowNodes(draft, catalog)
  if (!inlined.ok) return inlined
  try {
    return { ok: true, rhai: compile(inlined.draft) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
