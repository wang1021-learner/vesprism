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

const COL_W = 380
const ROW_H = 220

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

/**
 * 清洗 start 节点字段定义：name 必须是纯标识符（AI 生成时可能输出
 * `"{\"phoneNumber\""` 这类带引号/花括号的污染），非法字符一律剔除。
 * 非数组/非对象条目丢弃；type 非法回退 string。
 */
export function sanitizeStartFields(fields: unknown): SchemaField[] {
  if (!Array.isArray(fields)) return []
  const out: SchemaField[] = []
  for (const f of fields) {
    if (!f || typeof f !== 'object') continue
    const raw = (f as { name?: unknown }).name
    if (typeof raw !== 'string') continue
    const name = raw.trim().replace(/[^A-Za-z0-9_]/g, '')
    if (!name) continue
    const rawType = (f as { type?: unknown }).type
    const type = ['string', 'number', 'boolean', 'object', 'array'].includes(String(rawType))
      ? (String(rawType) as SchemaField['type'])
      : 'string'
    const required = (f as { required?: unknown }).required !== false
    const description =
      typeof (f as { description?: unknown }).description === 'string'
        ? ((f as { description?: string }).description as string)
        : undefined
    out.push({ name, type, required, ...(description ? { description } : {}) })
  }
  return out
}

/** 从 start 节点字段生成试跑参数 JSON 模板（供试跑输入框默认值）。无字段返回 null。 */
export function testInputTemplate(fields: SchemaField[] | undefined | null): string | null {
  if (!fields || fields.length === 0) return null
  const obj: Record<string, string> = {}
  for (const f of fields) {
    if (!f.name) continue
    obj[f.name] = f.type === 'number' ? '0' : f.type === 'boolean' ? 'false' : ''
  }
  return JSON.stringify(obj, null, 2)
}

export function startFieldsFromNodes(
  nodes: Array<{ type: string; params?: unknown }> | undefined | null,
): SchemaField[] | undefined {
  const start = (nodes ?? []).find((n) => n.type === 'start')
  return (start?.params as { fields?: SchemaField[] } | undefined)?.fields
}

/** 无 start 字段时的空对象（pretty），避免用 `{ "input": "" }` 冒充用户已填。 */
export function defaultTestInput(fields?: SchemaField[] | null): string {
  return testInputTemplate(fields) ?? '{\n}'
}

export function isEmptyTestInput(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return true
  try {
    const v = JSON.parse(t) as unknown
    return Boolean(
      v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0,
    )
  } catch {
    return false
  }
}

/** 旧默认占位 `{ "input": "" }`：新流程 start 字段就叫 input 时这是合法模板，否则当残留。 */
export function isLegacyDefaultTestInput(text: string): boolean {
  try {
    const v = JSON.parse((text || '').trim()) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false
    const keys = Object.keys(v as object)
    return keys.length === 1 && keys[0] === 'input' && (v as { input: unknown }).input === ''
  } catch {
    return false
  }
}

export function resolveTestInput(
  saved: string | null | undefined,
  fields?: SchemaField[] | null,
): string {
  const auto = defaultTestInput(fields)
  if (!saved || isEmptyTestInput(saved)) return auto
  if (isLegacyDefaultTestInput(saved)) {
    const names = (fields ?? []).map((f) => f.name).filter(Boolean)
    const onlyInput = names.length === 1 && names[0] === 'input'
    if (!onlyInput) return auto
  }
  return saved
}

export function shouldPersistTestInput(text: string, autoTemplate: string): boolean {
  const t = (text || '').trim()
  const auto = (autoTemplate || '').trim()
  if (!t || isEmptyTestInput(t) || t === auto) return false
  if (isLegacyDefaultTestInput(t) && t !== auto) return false
  return true
}

export function parseTestInputForRun(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = (text || '').trim()
  if (!t || isEmptyTestInput(t)) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(t) as unknown }
  } catch {
    return { ok: false }
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

/** 按思维导图树状拓扑分层自动排坐标（宽裕间距、分支居中、消除拥挤） */
export function layoutGraph(graph: FlowGraphJson): FlowGraphNode[] {
  if (!graph.nodes.length) return []

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

  // 1. 拓扑分层 (Longest-path layering)
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

  // 2. 按层分组
  const buckets = new Map<number, string[]>()
  for (const n of graph.nodes) {
    const L = layer.get(n.id) ?? 0
    const list = buckets.get(L) ?? []
    list.push(n.id)
    buckets.set(L, list)
  }

  const sortedLayers = Array.from(buckets.keys()).sort((a, b) => a - b)
  const pos = new Map<string, { x: number; y: number }>()

  // 3. 自左向右初排：按照父节点相对位置做重心排序并给初值
  for (const L of sortedLayers) {
    const ids = buckets.get(L)!
    if (L > 0) {
      // 重心排序：按上游节点的平均 Y 坐标排序，减少连线交叉
      ids.sort((a, b) => {
        const parentsA = incoming.get(a) ?? []
        const parentsB = incoming.get(b) ?? []
        const avgYA = parentsA.length
          ? parentsA.reduce((sum, p) => sum + (pos.get(p)?.y ?? 0), 0) / parentsA.length
          : 0
        const avgYB = parentsB.length
          ? parentsB.reduce((sum, p) => sum + (pos.get(p)?.y ?? 0), 0) / parentsB.length
          : 0
        return avgYA - avgYB
      })
    }

    // 初步分配 Y 坐标
    let prevY = -Infinity
    ids.forEach((id, i) => {
      const parents = incoming.get(id) ?? []
      let targetY: number
      if (parents.length > 0) {
        // 父节点平均中心
        targetY = parents.reduce((sum, p) => sum + (pos.get(p)?.y ?? 0), 0) / parents.length
      } else {
        targetY = 100 + i * ROW_H
      }

      // 保证同一列内不重叠，保留至少 ROW_H 的安全间距
      if (targetY < prevY + ROW_H) {
        targetY = prevY === -Infinity ? 100 : prevY + ROW_H
      }
      prevY = targetY

      pos.set(id, {
        x: 80 + L * COL_W,
        y: targetY,
      })
    })
  }

  // 4. 自右向左反向微调（思维导图树状居中）：让有子节点的父节点对齐子节点垂直中心
  for (let idx = sortedLayers.length - 1; idx >= 0; idx--) {
    const L = sortedLayers[idx]
    const ids = buckets.get(L)!
    for (const id of ids) {
      const children = outgoing.get(id) ?? []
      if (children.length > 0) {
        const childYs = children.map((c) => pos.get(c)?.y ?? 0)
        const minY = Math.min(...childYs)
        const maxY = Math.max(...childYs)
        const centerY = (minY + maxY) / 2
        const cur = pos.get(id)!
        pos.set(id, { ...cur, y: centerY })
      }
    }

    // 重新校准同一层内节点，确保不重叠
    for (let i = 1; i < ids.length; i++) {
      const prev = pos.get(ids[i - 1])!
      const cur = pos.get(ids[i])!
      if (cur.y < prev.y + ROW_H) {
        pos.set(ids[i], { ...cur, y: prev.y + ROW_H })
      }
    }
  }

  // 5. 正向微调一次（消除反向调整引入的重叠）
  for (const L of sortedLayers) {
    const ids = buckets.get(L)!
    for (let i = 1; i < ids.length; i++) {
      const prev = pos.get(ids[i - 1])!
      const cur = pos.get(ids[i])!
      if (cur.y < prev.y + ROW_H) {
        pos.set(ids[i], { ...cur, y: prev.y + ROW_H })
      }
    }
  }

  // 6. 坐标平移：确保最小 Y 为 80，最小 X 为 80
  let minY = Infinity
  for (const p of pos.values()) {
    if (p.y < minY) minY = p.y
  }
  const shiftY = minY < 80 ? 80 - minY : 0

  return graph.nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: 80, y: 80 }
    return {
      ...n,
      position: {
        x: p.x,
        y: Math.round(p.y + shiftY),
      },
    }
  })
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
  // 清洗 AI 生成的 start 字段（name 纯标识符），防 `{"phoneNumber"` 类污染进草稿。
  const nodes = layoutGraph({
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.type === 'start'
        ? {
            ...n,
            params: {
              ...n.params,
              fields: sanitizeStartFields((n.params as { fields?: unknown })?.fields),
            },
          }
        : n,
    ),
  })
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
