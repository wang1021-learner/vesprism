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

/**
 * 把含 `{{变量}}` 的文本编译成 Rhai 表达式/字符串字面量。
 * 支持的变量：`{{prev.output}}` / `{{prev}}`（上一步输出）、`{{input}}` / `{{start.input}}`（流程初始输入）、
 * `{{<节点id>.output}}`（任意上游节点输出，编译期校验存在性）。
 * - 纯单个变量 → 直接返回表达式（用于常量节点/条件等）。
 * - 文本夹杂变量 → 生成 `"前缀" + X.to_string() + "后缀"` 拼接。
 * - 未知变量 → 保留字面量 `{{...}}` 文本，不静默变空。
 */
function interpolateRhai(text: string, prevVar: string): string {
  const t = text ?? ''
  const re = /\{\{\s*([^}]+?)\s*\}\}/g
  const parts: Array<{ kind: 'text' | 'expr'; value: string }> = []
  let last = 0
  let count = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push({ kind: 'text', value: t.slice(last, m.index) })
    parts.push({ kind: 'expr', value: m[1].trim() })
    last = m.index + m[0].length
    count++
  }
  if (last < t.length) parts.push({ kind: 'text', value: t.slice(last) })
  if (count === 0) return `"${esc(t)}"`
  const toExpr = (v: string): string | null => {
    const key = v.toLowerCase()
    // {{prev}} = 整个结果 wrapper（含 success/output/tokens_used）；{{input}} = 流程初始输入（本身是内容）。
    if (key === 'prev') return prevVar
    if (key === 'input' || key === 'start.input') return 'input'
    // 深层字段：{{prev.output.id}} / {{节点id.output.score}} → 内容对象里继续钻。
    const deep = v.match(/^(.+?\.output)((?:\.[A-Za-z0-9_]+)+)$/)
    if (deep) {
      const ref = deep[1].match(/^(.+)\.output$/i)
      if (ref && ref[1]) {
        const k = ref[1].toLowerCase()
        const base = k === 'prev' ? prevVar : k === 'input' || k === 'start' ? 'input' : ident(ref[1])
        return `${base}.output${deep[2]}`
      }
      return null
    }
    // {{x.output}} 统一语义 = 该节点输出的内容（agent 结果的 output 字段），不是整个 wrapper。
    const ref = v.match(/^(.+)\.output$/i)
    if (ref && ref[1]) {
      const k = ref[1].toLowerCase()
      if (k === 'prev') return `${prevVar}.output`
      return `${ident(ref[1])}.output`
    }
    return null
  }
  if (parts.length === 1 && parts[0].kind === 'expr') {
    const e = toExpr(parts[0].value)
    if (e) return e
    return `"${esc(t)}"`
  }
  const pieces = parts.map((p) => {
    if (p.kind === 'text') return `"${esc(p.value)}"`
    const e = toExpr(p.value)
    return e ? `${e}.to_string()` : `"${esc(`{{${p.value}}}`)}"`
  })
  return pieces.length === 1 ? pieces[0] : pieces.join(' + ')
}

/** 收集文本里的 {{...}} 引用列表（trim 后）。 */
export function collectVarRefs(text: string): string[] {
  const re = /\{\{\s*([^}]+?)\s*\}\}/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text ?? ''))) out.push(m[1].trim())
  return out
}

/**
 * 编译期校验：节点文本字段里的 `{{节点id.output}}` 引用必须指向图中真实存在的节点。
 * 未知变量（如拼错的 prev）保留字面量由运行时决定，不在这里报错。
 */
function validateVarRefs(draft: FlowDraft): string | null {
  const ids = new Set(draft.nodes.map((n) => n.id))
  for (const n of draft.nodes) {
    for (const value of Object.values(n.params ?? {})) {
      if (typeof value !== 'string') continue
      for (const ref of collectVarRefs(value)) {
        const m = ref.match(/^(.+)\.output(?:\.[A-Za-z0-9_]+)*$/i)
        if (m && m[1]) {
          const key = m[1].toLowerCase()
          if (key !== 'prev' && key !== 'input' && key !== 'start' && !ids.has(m[1])) {
            return `节点 ${n.id} 引用了不存在的节点「${m[1]}」（{{${ref}}}）`
          }
        }
      }
    }
  }
  return null
}

/**
 * 编译期检测标识符冲突：
 * - 两个不同节点 id 规范化后相同（如 `a-b` 与 `a_b` 都变 `a_b`）→ 变量覆盖，报错。
 * - 规范化后与引擎保留变量/内部前缀撞名（input/prev/item/attempt/args/meta、par_/loop_/v_）→ 报错。
 */
function validateIdentCollisions(draft: FlowDraft): string | null {
  const seen = new Map<string, string>()
  const RESERVED = new Set(['input', 'prev', 'item', 'attempt', 'args', 'meta'])
  for (const n of draft.nodes) {
    const v = ident(n.id)
    const prior = seen.get(v)
    if (prior && prior !== n.id) {
      return `节点「${prior}」与「${n.id}」编译后的变量名冲突（${v}），会导致变量覆盖；请改用语义化 id（如 ${n.type}-main）`
    }
    seen.set(v, n.id)
    if (RESERVED.has(v) || /^(par_|loop_|v_)/.test(v)) {
      return `节点 id「${n.id}」编译后的变量名 ${v} 与引擎保留变量冲突；请改用语义化 id（如 ${n.type}-main）`
    }
  }
  return null
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
  const label = nodeLabel(n).trim()
  const base = label ? label.slice(0, 40) : ''
  // 附加节点 id：同 label 节点的 phase 状态互不污染（官方 phase 事件只有 title），
  // 试跑回填时也能按 id 精确匹配。
  return base ? `${base} · ${n.id}` : n.id
}

function outgoing(edges: FlowGraphEdge[], id: string): FlowGraphEdge[] {
  return edges.filter((e) => e.from === id)
}

function incoming(edges: FlowGraphEdge[], id: string): FlowGraphEdge[] {
  return edges.filter((e) => e.to === id)
}

function agentTaskLiteral(n: FlowGraphNode, prevVar: string, resolved?: PresetResolve): string {
  const p = n.params as { role?: string; prompt?: string }
  const fields: string[] = [`node_id: ${jsonToRhaiLiteral(n.id)}`]
  const persona = resolved?.systemPrompt?.trim() || resolved?.description?.trim()
  if (persona) fields.push(`persona: ${jsonToRhaiLiteral(persona)}`)
  if (p.role?.trim()) fields.push(`role: ${interpolateRhai(p.role, prevVar)}`)
  if (p.prompt?.trim()) fields.push(`prompt: ${interpolateRhai(p.prompt, prevVar)}`)
  if (resolved?.skills?.length) fields.push(`skills: ${jsonToRhaiLiteral(resolved.skills)}`)
  fields.push(`input: ${prevVar}`)
  return `#{ ${fields.join(', ')} }`
}

function toolTaskLiteral(
  n: FlowGraphNode,
  prevVar: string,
  p: { toolName?: string; command?: string; args?: Record<string, unknown>; timeoutSecs?: number },
): string {
  const cmd = (p.command || p.toolName || '').trim()
  const fields: string[] = [`node_id: ${jsonToRhaiLiteral(n.id)}`, `kind: "tool"`]
  if (cmd) fields.push(`command: ${interpolateRhai(cmd, prevVar)}`)
  if (p.args && Object.keys(p.args).length > 0) fields.push(`args: ${jsonToRhaiLiteral(p.args)}`)
  const timeoutSecs = Number(p.timeoutSecs)
  if (Number.isFinite(timeoutSecs) && timeoutSecs > 0) {
    fields.push(`timeout_secs: ${Math.floor(timeoutSecs)}`)
  }
  fields.push(`input: ${prevVar}`)
  return `#{ ${fields.join(', ')} }`
}

function httpTaskLiteral(
  n: FlowGraphNode,
  prevVar: string,
  p: { url?: string; method?: string; headers?: string; body?: string; timeoutSecs?: number },
): string {
  const method = (p.method || 'GET').toUpperCase()
  const url = (p.url || '').trim()
  const headers = (p.headers || '').trim()
  const body = (p.body || '').trim()
  const timeoutSecs = Number(p.timeoutSecs)
  const lines: string[] = [
    `发起一次真实的 HTTP ${method} 请求到「${url}」，把响应内容（状态码、响应头、响应体）作为结果返回。`,
  ]
  if (headers) lines.push(`请求头（每行一条 Name: value）：\n${headers}`)
  if (body) lines.push(`请求体：\n${body}`)
  if (Number.isFinite(timeoutSecs) && timeoutSecs > 0) {
    lines.push(`请求必须设置超时：${Math.floor(timeoutSecs)} 秒内无响应即视为失败。`)
  }
  lines.push('要求：请求必须真实发出，禁止伪造或编造响应；请求失败时如实报告错误。')
  lines.push(
    '纯 GET 且无需自定义请求头/请求体时可用 web_fetch；需要自定义方法、请求头或请求体时用 shell 工具（bash 用 curl，PowerShell 用 curl.exe 或 Invoke-RestMethod）。',
  )
  const fields: string[] = [`node_id: ${jsonToRhaiLiteral(n.id)}`, `kind: "http"`]
  fields.push(`prompt: ${interpolateRhai(lines.join('\n'), prevVar)}`)
  fields.push(`input: ${prevVar}`)
  return `#{ ${fields.join(', ')} }`
}

function databaseTaskLiteral(
  n: FlowGraphNode,
  prevVar: string,
  p: { sql?: string; dbPath?: string },
): string {
  const sql = (p.sql ?? '').trim()
  const dbPath = (p.dbPath ?? '').trim()
  const lines: string[] = [
    '用 database_query 工具对本地 SQLite 数据库真实执行 SQL 并返回结果（SELECT 返回行，其他返回影响行数）。',
    `SQL：\n${sql}`,
  ]
  if (dbPath) lines.push(`数据库文件：${dbPath}（省略用默认库 ~/.vesprism/mcp/db.sqlite）`)
  lines.push('要求：必须真实执行，禁止编造查询结果；执行失败时如实报告错误。')
  const fields: string[] = [`node_id: ${jsonToRhaiLiteral(n.id)}`, `kind: "database"`]
  fields.push(`prompt: ${interpolateRhai(lines.join('\n'), prevVar)}`)
  fields.push(`input: ${prevVar}`)
  return `#{ ${fields.join(', ')} }`
}

function knowledgeTaskLiteral(
  n: FlowGraphNode,
  prevVar: string,
  p: { knowledgeBase?: string; query?: string; limit?: number },
): string {
  const kb = (p.knowledgeBase ?? '').trim()
  const query = (p.query ?? '').trim()
  const limit = Number(p.limit)
  const lines: string[] = [
    `用 knowledge_search 工具在本地知识库「${kb}」全文检索：${query}`,
  ]
  if (Number.isFinite(limit) && limit > 0) {
    lines.push(`最多返回 ${Math.floor(limit)} 条命中片段。`)
  }
  lines.push('要求：必须真实检索，返回命中片段与来源文件，禁止编造内容；检索失败时如实报告错误。')
  const fields: string[] = [`node_id: ${jsonToRhaiLiteral(n.id)}`, `kind: "knowledge"`]
  fields.push(`prompt: ${interpolateRhai(lines.join('\n'), prevVar)}`)
  fields.push(`input: ${prevVar}`)
  return `#{ ${fields.join(', ')} }`
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
  const resolved = resolveAgentOpts(n, presets)
  const task = agentTaskLiteral(n, prevVar, resolved)
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
  // 官方 AgentOpts.max_output_tokens：单次 agent 输出上限，0/空不传。
  const rawTokens = (n.params as { maxOutputTokens?: unknown }).maxOutputTokens
  const tokens =
    typeof rawTokens === 'number' ? rawTokens : Number(String(rawTokens ?? '').trim())
  if (Number.isFinite(tokens) && tokens > 0) {
    opts.push(`max_output_tokens: ${Math.floor(tokens)}`)
  }
  // 官方 AgentOpts.timeout_ms：整个 agent 调用墙钟超时（秒 × 1000），0/空不传。
  pushTimeoutMs(opts, n)
  const call = (target: string) => {
    lines.push(`let ${target} = agent(json_encode(${task}), #{ ${opts.join(', ')} });`)
  }
  return wrapRetry(n, lines, 'agent', call)
}

/** 把节点 timeoutSecs（秒）编译进官方 AgentOpts.timeout_ms（毫秒）；0/空不传。 */
function pushTimeoutMs(opts: string[], n: FlowGraphNode): void {
  const raw = (n.params as { timeoutSecs?: unknown }).timeoutSecs
  const secs = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (Number.isFinite(secs) && secs > 0) {
    opts.push(`timeout_ms: ${Math.floor(secs * 1000)}`)
  }
}

/** 节点 retry 参数归一化：非正数/非法值 → 0（不重试）。 */
function retryCountOf(n: FlowGraphNode): number {
  const raw = (n.params as { retry?: unknown }).retry
  const num = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

/**
 * 失败重试包装：`retry <= 0` 单次调用直接短路；否则生成
 * `let v = (); for attempt in 0..N { let v_try = <call>; if ok { v = v_try; break; } }
 * if 仍失败 complete 报错`。重试次数真实生效（编译成循环逻辑）。
 */
function wrapRetry(
  n: FlowGraphNode,
  lines: string[],
  kind: string,
  call: (target: string) => void,
): string {
  const v = ident(n.id)
  const retry = retryCountOf(n)
  if (retry <= 0) {
    call(v)
    lines.push(
      `if ${v} == () || !${v}.success { complete(#{ ok: false, node: "${esc(n.id)}", error: "${kind} failed" }); }`,
    )
    return v
  }
  lines.push(`let ${v} = ();`)
  lines.push(`for attempt in 0..${retry + 1} {`)
  call(`${v}_try`)
  lines.push(`  if ${v}_try != () && ${v}_try.success { ${v} = ${v}_try; break; }`)
  lines.push(`}`)
  lines.push(
    `if ${v} == () || !${v}.success { complete(#{ ok: false, node: "${esc(n.id)}", error: "${kind} failed after ${retry + 1} attempts" }); }`,
  )
  return v
}

function emitToolCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const p = n.params as {
    toolName?: string
    command?: string
    args?: Record<string, unknown>
    outputSchema?: unknown
  }
  const task = toolTaskLiteral(n, prevVar, p)
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} tool");`)
  const opts: string[] = [`label: "${esc(n.id)}"`, `capability_mode: "execute"`]
  if (p.outputSchema !== undefined && p.outputSchema !== null) {
    opts.push(`output_schema: ${jsonToRhaiLiteral(p.outputSchema)}`)
  }
  pushTimeoutMs(opts, n)
  const call = (target: string) => {
    lines.push(`let ${target} = agent(json_encode(${task}), #{ ${opts.join(', ')} });`)
  }
  return wrapRetry(n, lines, 'tool', call)
}

function emitHttpCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const p = n.params as { url?: string; method?: string; headers?: string; body?: string; outputSchema?: unknown }
  const task = httpTaskLiteral(n, prevVar, p)
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} http");`)
  const opts: string[] = [`label: "${esc(n.id)}"`, `capability_mode: "execute"`]
  if (p.outputSchema !== undefined && p.outputSchema !== null) {
    opts.push(`output_schema: ${jsonToRhaiLiteral(p.outputSchema)}`)
  }
  pushTimeoutMs(opts, n)
  const call = (target: string) => {
    lines.push(`let ${target} = agent(json_encode(${task}), #{ ${opts.join(', ')} });`)
  }
  return wrapRetry(n, lines, 'http', call)
}

function emitDatabaseCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const p = n.params as { sql?: string; dbPath?: string }
  const task = databaseTaskLiteral(n, prevVar, p)
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} database");`)
  const call = (target: string) => {
    lines.push(
      `let ${target} = agent(json_encode(${task}), #{ label: "${esc(n.id)}", capability_mode: "execute" });`,
    )
  }
  return wrapRetry(n, lines, 'database', call)
}

function emitKnowledgeCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const p = n.params as { knowledgeBase?: string; query?: string; limit?: number }
  const task = knowledgeTaskLiteral(n, prevVar, p)
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} knowledge");`)
  const call = (target: string) => {
    lines.push(
      `let ${target} = agent(json_encode(${task}), #{ label: "${esc(n.id)}", capability_mode: "execute" });`,
    )
  }
  return wrapRetry(n, lines, 'knowledge', call)
}

/** 变量/常量节点：常量按 valueType 解析；含 {{}} 时走运行时替换。 */
function emitVariableCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const v = ident(n.id)
  const p = n.params as { value?: string; valueType?: string }
  const raw = (p.value ?? '').trim()
  const type = p.valueType || 'string'
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} variable");`)
  let lit: string
  if (raw.includes('{{')) {
    lit = interpolateRhai(raw, prevVar)
  } else if (type === 'number') {
    const num = Number(raw)
    lit = Number.isFinite(num) ? String(num) : `"${esc(raw)}"`
  } else if (type === 'boolean') {
    lit = raw === 'true' || raw === '1' ? 'true' : 'false'
  } else if (type === 'json') {
    try {
      lit = jsonToRhaiLiteral(JSON.parse(raw))
    } catch {
      lit = `"${esc(raw)}"`
    }
  } else {
    lit = `"${esc(raw)}"`
  }
  lines.push(`let ${v} = ${lit};`)
  return v
}

/** 代码/Transform 节点：Rhai 表达式，`input` 引用上游输出；异常直接 complete 报错。 */
function emitTransformCall(n: FlowGraphNode, prevVar: string, lines: string[]): string {
  const v = ident(n.id)
  const p = n.params as { code?: string }
  const code = (p.code ?? '').trim()
  lines.push(`phase("${esc(phaseTitle(n))}");`)
  lines.push(`log("node ${esc(n.id)} transform");`)
  if (!code) {
    lines.push(`let ${v} = ${prevVar};`)
    return v
  }
  // 用 Rhai 块作用域把 input 绑定到上游输出：块内 let input 局部 shadow，块外不受影响。
  // 不再做 \binput\b 文本替换——避免误伤字符串字面量（"the input"）与属性访问（foo.input）。
  lines.push(`let ${v} = ();`)
  lines.push(`try {`)
  lines.push(`    ${v} = { let input = ${prevVar}; (${code}) };`)
  lines.push(`} catch (err) {`)
  lines.push(`    complete(#{ ok: false, node: "${esc(n.id)}", error: err.to_string() });`)
  lines.push(`}`)
  return v
}

function buildAgentJobMap(
  n: FlowGraphNode,
  prevVar: string,
  presets: Record<string, PresetResolve>,
): string {
  if (n.type === 'agent') {
    const resolved = resolveAgentOpts(n, presets)
    const task = agentTaskLiteral(n, prevVar, resolved)
    const opts: string[] = [`prompt: json_encode(${task})`, `label: "${esc(n.id)}"`]
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
    const task = toolTaskLiteral(n, prevVar, p)
    return `#{ prompt: json_encode(${task}), label: "${esc(n.id)}", capability_mode: "execute" }`
  } else if (n.type === 'http') {
    const p = n.params as { url?: string; method?: string; headers?: string; body?: string }
    const task = httpTaskLiteral(n, prevVar, p)
    return `#{ prompt: json_encode(${task}), label: "${esc(n.id)}", capability_mode: "execute" }`
  }
  return `#{ prompt: json_encode(#{ node_id: ${jsonToRhaiLiteral(n.id)}, input: ${prevVar} }), label: "${esc(n.id)}" }`
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
    case 'http':
      return emitHttpCall(n, prevVar, lines)
    case 'database':
      return emitDatabaseCall(n, prevVar, lines)
    case 'knowledge':
      return emitKnowledgeCall(n, prevVar, lines)
    case 'variable':
      return emitVariableCall(n, prevVar, lines)
    case 'transform':
      return emitTransformCall(n, prevVar, lines)
    case 'loop':
      // walk 已特判拦截循环体；这里兜底（直接透传上游）
      return prevVar
    case 'loop_end':
      // 汇聚输出 = 结果数组（由 loop 分支编译生成）
      return prevVar
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

  // ── For-Each 迭代节点 (loop → body → loop_end) ──
  if (node.type === 'loop') {
    const bodyEdge = outs[0]
    const bodyNode = bodyEdge ? nodes.get(bodyEdge.to) : undefined
    if (!bodyNode) {
      visiting.delete(currentId)
      return prevVar
    }
    const bodyOuts = outgoing(edges, bodyNode.id)
    const endEdge = bodyOuts[0]
    const loopArr = `loop_${ident(node.id)}_arr`
    const resVar = `loop_${ident(node.id)}_res`
    lines.push(`phase("${esc(phaseTitle(node))}");`)
    lines.push(`log("node ${esc(node.id)} loop over ${prevVar}");`)
    lines.push(`let ${loopArr} = ${prevVar};`)
    lines.push(`let ${resVar} = [];`)
    lines.push(`for item in ${loopArr} {`)
    const bodyOutVar = emitNode(bodyNode, 'item', lines, presets)
    lines.push(`    ${resVar}.push(${bodyOutVar});`)
    lines.push(`}`)
    visiting.add(bodyNode.id)
    if (endEdge && nodes.get(endEdge.to)?.type === 'loop_end') {
      visiting.add(endEdge.to)
      visiting.delete(currentId)
      return walk(endEdge.to, resVar, nodes, edges, lines, visiting, presets)
    }
    visiting.delete(currentId)
    return resVar
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
  const refErr = validateVarRefs(draft)
  if (refErr) {
    throw new Error(refErr)
  }
  const collErr = validateIdentCollisions(draft)
  if (collErr) {
    throw new Error(collErr)
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
