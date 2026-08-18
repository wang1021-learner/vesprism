/**
 * 画布 JSON → 官方 Rhai 工作流。v1 线性 + 分支；不生成循环/并行节点。
 */
import { graphJsonFromDraft, nodeLabel } from './graph'
import { validateFlowGraph } from './schema'
import type { FlowDraft, FlowGraphEdge, FlowGraphNode } from './types'

/** 发布时把工作台 Agent 收成官方 AgentOpts 能认的字段。 */
export type PresetResolve = {
  name?: string
  description?: string
  systemPrompt?: string
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
  /** Agent 挂载的技能列表 */
  skills?: string[]
}
export type CompileOpts = { presets?: Record<string, PresetResolve> }

export function officialCapability(raw?: string | null): string | undefined {
  if (!raw) return undefined
  const key = raw.trim().toLowerCase().replace(/_/g, '-')
  if (!key) return undefined
  if (key === 'read-only' || key === 'readonly') return 'read-only'
  if (key === 'read-write' || key === 'readwrite') return 'read-write'
  if (key === 'execute') return 'execute'
  if (key === 'all') return 'all'
  return raw.trim()
}

function pushIsolation(opts: string[], isolation: boolean | undefined): void {
  if (isolation === true) opts.push('isolation_worktree: true')
  if (isolation === false) opts.push('isolation_worktree: false')
}

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

function agentPrompt(n: FlowGraphNode, resolved?: PresetResolve): string {
  const p = n.params as { role?: string; prompt?: string }
  const parts: string[] = []
  if (resolved?.systemPrompt?.trim()) {
    parts.push(resolved.systemPrompt.trim())
  } else if (resolved?.description?.trim()) {
    parts.push(`【角色定位】：${resolved.description.trim()}`)
  }
  if (p.role?.trim() && !resolved?.systemPrompt?.includes(p.role.trim())) {
    parts.push(`【职责】：${p.role.trim()}`)
  }
  if (p.prompt?.trim()) {
    parts.push(p.prompt.trim())
  }
  if (parts.length === 0) {
    parts.push('根据上一步输出完成本节点任务，给出简洁结果。')
  }
  parts.push('输入（JSON）：')
  return parts.join('\n\n')
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
    skills?: string[]
  }
  const presetId = p.presetId?.trim()
  let name: string | undefined
  let description: string | undefined
  let systemPrompt: string | undefined
  let model = p.model?.trim()
  let agentType = p.agentType?.trim()
  let capability = officialCapability(p.capability)
  let isolation = p.isolation
  let outputSchema: unknown
  let disabledTools: string[] | undefined
  let permissionRules: string[] | undefined
  let skills: string[] | undefined = p.skills
  if (presetId) {
    const resolved = presets[presetId]
    if (!resolved) {
      throw new Error(`Agent「${presetId}」不存在，无法编译节点 ${n.id}`)
    }
    name = resolved.name
    description = resolved.description
    systemPrompt = resolved.systemPrompt
    if (!model) model = resolved.model?.trim()
    if (!agentType) agentType = resolved.agentType?.trim()
    if (!capability) capability = officialCapability(resolved.capability)
    if (isolation === undefined) isolation = resolved.isolation
    if (resolved.outputSchema !== undefined) outputSchema = resolved.outputSchema
    if (resolved.disabledTools?.length) disabledTools = resolved.disabledTools
    if (resolved.permissionRules?.length) permissionRules = resolved.permissionRules
    if (resolved.skills?.length && !skills?.length) skills = resolved.skills
  }
  return {
    name,
    description,
    systemPrompt,
    model: model || undefined,
    agentType: agentType || undefined,
    capability: capability || undefined,
    isolation,
    outputSchema,
    disabledTools,
    permissionRules,
    skills,
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
  let prompt = agentPrompt(n, resolved)
  if (resolved.skills && resolved.skills.length > 0) {
    prompt += `\n\n【可用技能 (Skills)】：${resolved.skills.join(', ')}`
  }
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)}");`)
  const opts: string[] = [`label: "${esc(n.id)}"`]
  if (resolved.model) opts.push(`model: "${esc(resolved.model)}"`)
  if (resolved.agentType) opts.push(`agent_type: "${esc(resolved.agentType)}"`)
  if (resolved.capability) opts.push(`capability_mode: "${esc(resolved.capability)}"`)
  pushIsolation(opts, resolved.isolation)
  if (resolved.outputSchema !== undefined) {
    opts.push(`output_schema: ${jsonToRhaiLiteral(resolved.outputSchema)}`)
  }
  if (resolved.disabledTools?.length) {
    const list = resolved.disabledTools.map((t) => `"${esc(t)}"`).join(', ')
    opts.push(`disabled_tools: [${list}]`)
  }
  if (resolved.permissionRules?.length) {
    const list = resolved.permissionRules.map((r) => `"${esc(r)}"`).join(', ')
    opts.push(`permission_rules: [${list}]`)
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
  lines.push(`log("node ${esc(n.id)} tool");`)
  lines.push(
    `let ${v} = agent("${esc(prompt)}" + json_encode(${prevVar}), #{ label: "${esc(n.id)}", capability_mode: "execute" });`,
  )
  lines.push(`if ${v} == () || !${v}.success { complete(#{ ok: false, node: "${esc(n.id)}", error: "tool failed" }); }`)
  return v
}

function buildAgentJobMap(
  n: FlowGraphNode,
  prevVar: string,
  presets: Record<string, PresetResolve>,
): string {
  if (n.type === 'agent') {
    const resolved = resolveAgentOpts(n, presets)
    let prompt = agentPrompt(n, resolved)
    if (resolved.skills && resolved.skills.length > 0) {
      prompt += `\n\n【可用技能 (Skills)】：${resolved.skills.join(', ')}`
    }
    const opts: string[] = [`prompt: "${esc(prompt)}" + json_encode(${prevVar})`, `label: "${esc(n.id)}"`]
    if (resolved.model) opts.push(`model: "${esc(resolved.model)}"`)
    if (resolved.agentType) opts.push(`agent_type: "${esc(resolved.agentType)}"`)
    if (resolved.capability) opts.push(`capability_mode: "${esc(resolved.capability)}"`)
    pushIsolation(opts, resolved.isolation)
    if (resolved.outputSchema !== undefined) {
      opts.push(`output_schema: ${jsonToRhaiLiteral(resolved.outputSchema)}`)
    }
    if (resolved.disabledTools?.length) {
      const list = resolved.disabledTools.map((t) => `"${esc(t)}"`).join(', ')
      opts.push(`disabled_tools: [${list}]`)
    }
    if (resolved.permissionRules?.length) {
      const list = resolved.permissionRules.map((r) => `"${esc(r)}"`).join(', ')
      opts.push(`permission_rules: [${list}]`)
    }
    return `#{ ${opts.join(', ')} }`
  } else if (n.type === 'tool') {
    const p = n.params as { toolName?: string; command?: string; args?: Record<string, unknown> }
    const cmd = (p.command || p.toolName || '').trim()
    const argsJson = esc(JSON.stringify(p.args ?? {}))
    const prompt = cmd
      ? `执行以下工具/命令并返回输出。命令：${cmd}；固定参数：${argsJson}；上一步输出：`
      : '根据上一步输出选择合适工具执行，并返回结果。上一步：'
    return `#{ prompt: "${esc(prompt)}" + json_encode(${prevVar}), label: "${esc(n.id)}", capability_mode: "execute" }`
  }
  return `#{ prompt: "执行任务" + json_encode(${prevVar}), label: "${esc(n.id)}" }`
}

function emitJoinCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const v = ident(n.id)
  const p = n.params as { mergeMode?: string }
  const mode = p.mergeMode || 'merge_json'
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} join (mode: ${esc(mode)})");`)
  if (mode === 'list') {
    lines.push(`let ${v} = ${prevVar};`)
  } else if (mode === 'all_success') {
    lines.push(`let ${v} = #{ ok: true, results: ${prevVar} };`)
  } else {
    lines.push(`let ${v} = #{};`)
    lines.push(`if type_of(${prevVar}) == "array" {`)
    lines.push(`    for item in ${prevVar} {`)
    lines.push(`        if type_of(item) == "map" {`)
    lines.push(`            let payload = item;`)
    lines.push(`            if item.contains("output") && type_of(item.output) == "map" {`)
    lines.push(`                payload = item.output;`)
    lines.push(`            }`)
    lines.push(`            for k in payload.keys() { ${v}[k] = payload[k]; }`)
    lines.push(`        }`)
    lines.push(`    }`)
    lines.push(`} else { ${v} = ${prevVar}; }`)
  }
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
    case 'parallel':
      return prevVar
    case 'join':
      return emitJoinCall(n, prevVar, lines)
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

  // ── 并行扇出节点 (Official Native Parallel) ──
  if (node.type === 'parallel' || (outs.length > 1 && node.type !== 'branch')) {
    const pVar = `par_${ident(node.id)}`
    lines.push(`phase("${esc(phaseTitle(node))}");`)
    lines.push(`log("node ${esc(node.id)} parallel fan-out (${outs.length} branches)");`)
    const branchNodes = outs.map((e) => nodes.get(e.to)).filter((n): n is FlowGraphNode => Boolean(n))
    lines.push(`let ${pVar}_jobs = [];`)
    for (const bNode of branchNodes) {
      visiting.add(bNode.id)
      const jobMap = buildAgentJobMap(bNode, prevVar, presets)
      lines.push(`${pVar}_jobs.push(${jobMap});`)
    }
    lines.push(`let ${pVar} = parallel(${pVar}_jobs);`)

    // 寻找并发分支汇聚的下游目标（如 join 节点或 end 节点）
    const downstreamIds = Array.from(
      new Set(branchNodes.flatMap((bn) => outgoing(edges, bn.id).map((e) => e.to))),
    )
    if (downstreamIds.length === 1) {
      const nextId = downstreamIds[0]
      visiting.delete(currentId)
      return walk(nextId, pVar, nodes, edges, lines, visiting, presets)
    }
    if (downstreamIds.length > 1) {
      throw new Error(
        `并行节点「${node.id}」的各个分支必须汇聚到同一个 join 结果汇聚网关（当前检测到不同下游: ${downstreamIds.join(', ')}）。如需多步流水线，请先封装为子流程。`,
      )
    }
    visiting.delete(currentId)
    return pVar
  }

  // ── 多路条件分支节点 (Branch / Switch) ──
  if (node.type === 'branch') {
    const p = node.params as { condition?: string; expression?: string }
    const branchResVar = `v_${ident(node.id)}_res`
    lines.push(`phase("${esc(phaseTitle(node))}");`)
    lines.push(`log("node ${esc(node.id)} branch");`)
    lines.push(`let ${branchResVar} = ${prevVar};`)

    const isBinarySuccessFailure =
      outs.length === 2 &&
      !outs.some(
        (e) =>
          e.label &&
          !/^(success|yes|true|ok|是|failure|no|false|否)$/i.test(e.label.trim()),
      )

    if (isBinarySuccessFailure) {
      const cond =
        p.condition === 'failure'
          ? `!(${prevVar} != () && ${prevVar}.success)`
          : p.condition === 'expression' && p.expression?.trim()
            ? p.expression.trim()
            : `${prevVar} != () && ${prevVar}.success`
      const yes =
        outs.find((e) => /^(success|yes|true|ok|是)$/i.test((e.label || '').trim())) ??
        outs[0]
      const no = outs.find((e) => e !== yes)
      lines.push(`if (${cond}) {`)
      if (yes) {
        const yesVar = walk(yes.to, prevVar, nodes, edges, lines, visiting, presets)
        lines.push(`    ${branchResVar} = ${yesVar};`)
      }
      if (no) {
        lines.push(`} else {`)
        const noVar = walk(no.to, prevVar, nodes, edges, lines, visiting, presets)
        lines.push(`    ${branchResVar} = ${noVar};`)
      }
      lines.push(`}`)
      visiting.delete(currentId)
      return branchResVar
    } else {
      for (let i = 0; i < outs.length; i++) {
        const edge = outs[i]
        const isLast = i === outs.length - 1
        const lbl = edge.label ? esc(edge.label.trim()) : ''
        const cond = lbl
          ? `(${prevVar} != () && (` +
            `(${prevVar}.output != () && (` +
              `(type_of(${prevVar}.output) == "map" && (${prevVar}.output.branch == "${lbl}" || ${prevVar}.output.decision == "${lbl}" || ${prevVar}.output.status == "${lbl}")) || ` +
              `(type_of(${prevVar}.output) == "string" && (${prevVar}.output == "${lbl}" || ${prevVar}.output.contains("${lbl}")))` +
            `)) || ` +
            `(${prevVar}.branch == "${lbl}") || (${prevVar} == "${lbl}")` +
          `))`
          : 'true'
        if (i === 0) {
          lines.push(`if (${cond}) {`)
        } else if (isLast && !edge.label) {
          lines.push(`} else {`)
        } else {
          lines.push(`} else if (${cond}) {`)
        }
        const armVar = walk(edge.to, prevVar, nodes, edges, lines, visiting, presets)
        lines.push(`    ${branchResVar} = ${armVar};`)
      }
      lines.push(`}`)
      visiting.delete(currentId)
      return branchResVar
    }
  }

  const produced = emitNode(node, prevVar, lines, presets)
  const nextEdge = outs[0]
  const last = nextEdge ? walk(nextEdge.to, produced, nodes, edges, lines, visiting, presets) : produced
  visiting.delete(currentId)
  return last
}

export function compileToRhai(draft: FlowDraft, opts: CompileOpts = {}): string {
  const checked = validateFlowGraph(graphJsonFromDraft(draft))
  if (!checked.ok) {
    throw new Error(`流程图校验失败: ${checked.error}`)
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
