/**
 * 画布 JSON → 官方 Rhai 工作流。v1 线性 + 分支；不生成循环/并行节点。
 */
import { collectDependencies, nodeLabel } from './graph'
import type { FlowDraft, FlowGraphEdge, FlowGraphNode } from './types'

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')
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
  const p = n.params as { role?: string; prompt?: string; presetId?: string }
  const parts: string[] = []
  if (p.presetId) parts.push(`你按组装单「${p.presetId}」行事。`)
  if (p.role) parts.push(p.role)
  if (p.prompt) parts.push(p.prompt)
  if (parts.length === 0) parts.push('根据上一步输出完成本节点任务，给出简洁结果。')
  parts.push('输入（JSON）：')
  return parts.join('\n')
}

function emitAgentCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const v = ident(n.id)
  const p = n.params as { model?: string }
  const prompt = agentPrompt(n)
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)}");`)
  const opts: string[] = [`label: "${esc(n.id)}"`]
  if (p.model && p.model.trim()) opts.push(`model: "${esc(p.model.trim())}"`)
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

function emitFlowCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const v = ident(n.id)
  const p = n.params as { flowId?: string; input?: Record<string, unknown> }
  const flowId = (p.flowId || '').trim() || 'unknown-flow'
  const extra = esc(JSON.stringify(p.input ?? {}))
  const prompt =
    `调用已发布流程 \`${flowId}\`。使用 workflow 工具或斜杠命令 /${flowId}。` +
    `附加参数：${extra}。把上一步输出一并传入：`
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} invoke ${esc(flowId)}");`)
  lines.push(
    `let ${v} = agent("${esc(prompt)}" + json_encode(${prevVar}), #{ label: "${esc(n.id)}", capability_mode: "all" });`,
  )
  lines.push(`if ${v} == () || !${v}.success { complete(#{ ok: false, node: "${esc(n.id)}", error: "flow failed" }); }`)
  return v
}

function emitNode(
  n: FlowGraphNode,
  prevVar: string,
  lines: string[],
): string {
  switch (n.type) {
    case 'start':
      return prevVar
    case 'end':
      return prevVar
    case 'agent':
      return emitAgentCall(n, prevVar, lines)
    case 'tool':
      return emitToolCall(n, prevVar, lines)
    case 'flow':
      return emitFlowCall(n, prevVar, lines)
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
    if (yes) last = walk(yes.to, prevVar, nodes, edges, lines, visiting)
    if (no) {
      lines.push(`} else {`)
      last = walk(no.to, prevVar, nodes, edges, lines, visiting)
    }
    lines.push(`}`)
    visiting.delete(currentId)
    return last
  }

  const produced = emitNode(node, prevVar, lines)
  let last = produced
  for (const e of outs) {
    last = walk(e.to, produced, nodes, edges, lines, visiting)
  }
  visiting.delete(currentId)
  return last
}

export function compileToRhai(draft: FlowDraft): string {
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
    ? walk(start.id, 'input', nodes, draft.edges, lines, new Set())
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

export function compileRhaiWithDepsNote(draft: FlowDraft): { rhai: string; dependencies: string[] } {
  return { rhai: compileToRhai(draft), dependencies: collectDependencies(draft.nodes) }
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
