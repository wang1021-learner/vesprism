/**
 * 画布 JSON → 官方 Rhai 工作流。v1 线性 + 分支；不生成循环/并行节点。
 */
import { graphJsonFromDraft, nodeLabel } from './graph'
import { validateFlowGraph } from './schema'
import type { FlowDraft, FlowGraphEdge, FlowGraphNode } from './types'

/** 发布时把工作台 Agent 收成官方 AgentOpts 能认的字段。 */
export type PresetResolve = {
  model?: string
  agentType?: string
  /** 官方 capability_mode 字符串：read-only / read-write / execute / all */
  capability?: string
  /** isolation_worktree：在隔离工作区里跑，弄脏不进主仓库 */
  isolation?: boolean
  /** JSON Schema，编译进 AgentOpts.output_schema（官方会按它重试） */
  outputSchema?: unknown
  /** 细粒度工具停用（工具短名或 `Name:tool` 全名），编译进 AgentOpts.disabled_tools */
  disabledTools?: string[]
  /** per-agent deny 规则（`kind:glob` 或 `glob`），编译进 AgentOpts.permission_rules */
  permissionRules?: string[]
}
export type CompileOpts = { presets?: Record<string, PresetResolve> }

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')
}

/** 把 JSON 值渲染成 Rhai 字面量（map 键一律加引号，安全兼容任意 schema 键）。 */
function jsonToRhaiLiteral(v: unknown): string {
  if (v === null || v === undefined) return '()'
  if (typeof v === 'string') return `"${esc(v)}"`
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return `[${v.map(jsonToRhaiLiteral).join(', ')}]`
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `"${esc(k)}": ${jsonToRhaiLiteral(val)}`,
    )
    return `#{ ${entries.join(', ')} }`
  }
  return '()'
}

function ident(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `n_${cleaned}`
}

function phaseTitle(n: FlowGraphNode): string {
  return nodeLabel(n).slice(0, 48) || n.id
}

function outgoing(edges: FlowGraphEdge[], id: string): FlowGraphEdge[] {
  return edges.filter((e) => e.from === id)
}

function incoming(edges: FlowGraphEdge[], id: string): FlowGraphEdge[] {
  return edges.filter((e) => e.to === id)
}

function agentPrompt(n: FlowGraphNode): string {
  const p = n.params as { role?: string; prompt?: string }
  const parts: string[] = []
  if (p.role) parts.push(p.role)
  if (p.prompt) parts.push(p.prompt)
  if (parts.length === 0) parts.push('根据上一步输出完成本节点任务，给出简洁结果。')
  parts.push('输入（JSON）：')
  return parts.join('\n')
}

function resolveAgentOpts(
  n: FlowGraphNode,
  presets: Record<string, PresetResolve>,
): PresetResolve {
  const p = n.params as {
    presetId?: string
    model?: string
    agentType?: string
    capability?: string
    isolation?: boolean
  }
  const presetId = p.presetId?.trim()
  let model = p.model?.trim()
  let agentType = p.agentType?.trim()
  // 节点显式值 > Agent 源 > 缺省。capability/isolation/outputSchema/disabledTools 只从 Agent 源来。
  let capability = p.capability?.trim()
  let isolation = p.isolation ?? false
  let outputSchema: unknown
  let disabledTools: string[] | undefined
  let permissionRules: string[] | undefined
  if (presetId) {
    const resolved = presets[presetId]
    if (!resolved) {
      throw new Error(`Agent「${presetId}」不存在，无法编译节点 ${n.id}`)
    }
    if (!model) model = resolved.model?.trim()
    if (!agentType) agentType = resolved.agentType?.trim()
    if (!capability) capability = resolved.capability?.trim()
    isolation = isolation || resolved.isolation === true
    if (resolved.outputSchema !== undefined) outputSchema = resolved.outputSchema
    if (resolved.disabledTools?.length) disabledTools = resolved.disabledTools
    if (resolved.permissionRules?.length) permissionRules = resolved.permissionRules
  }
  return {
    model: model || undefined,
    agentType: agentType || undefined,
    capability: capability || undefined,
    isolation: isolation || undefined,
    outputSchema,
    disabledTools,
    permissionRules,
  }
}

function emitAgentCall(
  n: FlowGraphNode,
  prevVar: string,
  lines: string[],
  presets: Record<string, PresetResolve>,
): string {
  const v = ident(n.id)
  const resolved = resolveAgentOpts(n, presets)
  const prompt = agentPrompt(n)
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)}");`)
  const opts: string[] = [`label: "${esc(n.id)}"`]
  if (resolved.model) opts.push(`model: "${esc(resolved.model)}"`)
  if (resolved.agentType) opts.push(`agent_type: "${esc(resolved.agentType)}"`)
  if (resolved.capability) opts.push(`capability_mode: "${esc(resolved.capability)}"`)
  if (resolved.isolation) opts.push(`isolation_worktree: true`)
  if (resolved.outputSchema !== undefined) {
    opts.push(`output_schema: ${jsonToRhaiLiteral(resolved.outputSchema)}`)
  }
  if (resolved.disabledTools && resolved.disabledTools.length > 0) {
    opts.push(`disabled_tools: ${jsonToRhaiLiteral(resolved.disabledTools)}`)
  }
  if (resolved.permissionRules && resolved.permissionRules.length > 0) {
    opts.push(`permission_rules: ${jsonToRhaiLiteral(resolved.permissionRules)}`)
  }
  lines.push(`let ${v} = agent("${esc(prompt)}" + json_encode(${prevVar}), #{ ${opts.join(', ')} });`)
  lines.push(`if ${v} == () || !${v}.success { complete(#{ ok: false, node: "${esc(n.id)}", error: "agent failed" }); }`)
  return v
}

function emitToolCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const v = ident(n.id)
  const p = n.params as { toolName?: string; command?: string; args?: Record<string, unknown> }
  const cmd = (p.command || p.toolName || '').trim()
  const argsJson = esc(JSON.stringify(p.args ?? {}))
  const prompt = cmd
    ? `执行以下工具/命令并返回输出。命令：${cmd}；固定参数：${argsJson}；上一步输出：`
    : '根据上一步输出选择合适工具执行，并返回结果。上一步：'
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)}");`)
  lines.push(
    `let ${v} = agent("${esc(prompt)}" + json_encode(${prevVar}), #{ label: "${esc(n.id)}", capability_mode: "execute" });`,
  )
  lines.push(`if ${v} == () || !${v}.success { complete(#{ ok: false, node: "${esc(n.id)}", error: "tool failed" }); }`)
  return v
}

function emitNode(
  n: FlowGraphNode,
  prevVar: string,
  lines: string[],
  presets: Record<string, PresetResolve>,
): string {
  switch (n.type) {
    case 'start':
      return prevVar
    case 'end':
      return prevVar
    case 'agent':
      return emitAgentCall(n, prevVar, lines, presets)
    case 'tool':
      return emitToolCall(n, prevVar, lines)
    case 'flow':
      throw new Error(`节点 ${n.id} 仍是 flow，发布/试跑前必须内联`)
    case 'branch':
      return prevVar
  }
}

function walk(
  currentId: string,
  prevVar: string,
  nodes: Map<string, FlowGraphNode>,
  edges: FlowGraphEdge[],
  lines: string[],
  visiting: Set<string>,
  presets: Record<string, PresetResolve>,
): string {
  if (visiting.has(currentId)) {
    lines.push(`log("skip cycle at ${esc(currentId)}");`)
    return prevVar
  }
  const node = nodes.get(currentId)
  if (!node) return prevVar
  visiting.add(currentId)

  const outs = outgoing(edges, currentId)
  if (node.type === 'end') {
    visiting.delete(currentId)
    return prevVar
  }

  if (node.type === 'branch') {
    const p = node.params as { condition?: string; expression?: string }
    const cond =
      p.condition === 'failure'
        ? `!(${prevVar} != () && ${prevVar}.success)`
        : p.condition === 'expression' && p.expression?.trim()
          ? p.expression.trim()
          : `${prevVar} != () && ${prevVar}.success`
    const yes = outs.find((e) => /success|yes|true|ok|是/i.test(e.label || '')) ?? outs[0]
    const no = outs.find((e) => e !== yes)
    lines.push(`phase("${esc(phaseTitle(node))}");`)
    lines.push(`log("node ${esc(node.id)} branch");`)
    lines.push(`if (${cond}) {`)
    let last = prevVar
    if (yes) last = walk(yes.to, prevVar, nodes, edges, lines, visiting, presets)
    if (no) {
      lines.push(`} else {`)
      last = walk(no.to, prevVar, nodes, edges, lines, visiting, presets)
    }
    lines.push(`}`)
    visiting.delete(currentId)
    return last
  }

  if (outs.length !== 1) {
    throw new Error(`节点 ${node.id} 必须恰好 1 条出边（v1 不并行）`)
  }
  const produced = emitNode(node, prevVar, lines, presets)
  const last = walk(outs[0].to, produced, nodes, edges, lines, visiting, presets)
  visiting.delete(currentId)
  return last
}

export function compileToRhai(draft: FlowDraft, opts: CompileOpts = {}): string {
  const checked = validateFlowGraph(graphJsonFromDraft(draft))
  if (!checked.ok) {
    throw new Error('流程图不合法：非分支节点只能有 1 条出边，分支必须恰好 2 条')
  }
  if (draft.nodes.some((n) => n.type === 'flow')) {
    throw new Error('仍有未内联的 flow 节点，不能编译')
  }
  const presets = opts.presets ?? {}
  const nodes = new Map(draft.nodes.map((n) => [n.id, n]))
  const starts = draft.nodes.filter((n) => n.type === 'start')
  const start = starts[0]
  const phases = draft.nodes
    .filter((n) => n.type !== 'start' && n.type !== 'end')
    .map((n) => `        #{ title: "${esc(phaseTitle(n))}" }`)

  const desc = (draft.description || draft.name || draft.id).trim()
  const lines: string[] = []
  lines.push('let meta = #{')
  lines.push(`    name: "${esc(draft.id)}",`)
  lines.push(`    description: "${esc(desc)}",`)
  lines.push(`    when_to_use: "${esc(desc)}",`)
  if (phases.length) {
    lines.push('    phases: [')
    lines.push(phases.join(',\n'))
    lines.push('    ],')
  }
  lines.push('};')
  lines.push('')
  lines.push('let input = args;')
  lines.push('if input == () { input = #{}; }')
  lines.push('')

  const last = start
    ? walk(start.id, 'input', nodes, draft.edges, lines, new Set(), presets)
    : 'input'

  lines.push('')
  lines.push(`complete(#{ ok: true, output: ${last} });`)
  lines.push('')
  return lines.join('\n')
}

export function collectPromptsMarkdown(draft: FlowDraft): string {
  const blocks: string[] = [`# ${draft.name}`, '']
  for (const n of draft.nodes) {
    if (n.type !== 'agent') continue
    const p = n.params as { prompt?: string; role?: string }
    if (!p.prompt && !p.role) continue
    blocks.push(`## ${nodeLabel(n)} (\`${n.id}\`)`)
    if (p.role) blocks.push('', p.role)
    if (p.prompt) blocks.push('', p.prompt)
    blocks.push('')
  }
  return blocks.join('\n')
}



/** 供测试：导出图中引用的节点是否都被 walk 到（无 start 则空脚本仍合法）。 */
export function listReachable(draft: FlowDraft): string[] {
  const start = draft.nodes.find((n) => n.type === 'start')
  if (!start) return []
  const seen = new Set<string>()
  const q = [start.id]
  while (q.length) {
    const id = q.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of outgoing(draft.edges, id)) q.push(e.to)
  }
  return Array.from(seen)
}

export function hasDanglingStart(draft: FlowDraft): boolean {
  const start = draft.nodes.find((n) => n.type === 'start')
  if (!start) return true
  return incoming(draft.edges, start.id).length > 0
}
