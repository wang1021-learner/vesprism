/**
 * 组装单（半插件化 P0）前端词汇：与后端 grok-session `Composition` 的 serde
 * snake_case 输出对齐；Goal/Workflow DTO 与后端 camelCase rename 对齐。
 */

export type PermissionMode = 'ask' | 'yolo' | 'auto'
export type Policy = 'ask' | 'deny' | 'allow_once' | 'allow_always'

export interface PermissionRule {
  match: string
  policy: Policy
}

export interface McpServerRefData {
  name: string
  url?: string | null
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
}

export interface CompositionData {
  id?: string | null
  extends?: string | null
  persona: { label?: string | null; sections: string[] }
  model: { name?: string | null; reasoning_effort?: string | null }
  tools: { disable: string[]; overrides?: unknown | null }
  skills: { scopes: string[]; exclude: string[] }
  permissions: { mode: PermissionMode; rules: PermissionRule[] }
  mcp: { servers: McpServerRefData[]; disabled_tools: Record<string, string[]> }
  plugins: { dirs: string[] }
  /** 挂到该会话的已发布流程 id（引擎 `_meta["x.ai/flows"]` → `flow__<id>`） */
  flows: string[]
  /** 流程节点引用该组装单时写入官方 AgentOpts.agent_type */
  agent_type?: string | null
}

export function emptyComposition(): CompositionData {
  return {
    id: null,
    extends: null,
    persona: { label: null, sections: [] },
    model: { name: null, reasoning_effort: null },
    tools: { disable: [], overrides: null },
    skills: { scopes: [], exclude: [] },
    permissions: { mode: 'ask', rules: [] },
    mcp: { servers: [], disabled_tools: {} },
    plugins: { dirs: [] },
    flows: [],
    agent_type: null,
  }
}

/** 按空格拆命令行，保留引号内片段。 */
export function splitCommandLine(line: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        parts.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

/** 组装单 MCP 行：`名称 | command args` 或 `名称 | https://…`。 */
export function parseMcpServerLine(line: string): McpServerRefData | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const pipe = trimmed.indexOf('|')
  const name = (pipe >= 0 ? trimmed.slice(0, pipe) : trimmed).trim()
  const rest = pipe >= 0 ? trimmed.slice(pipe + 1).trim() : ''
  if (!name) return null
  if (/^https?:\/\//i.test(rest)) {
    return { name, url: rest, command: null, args: null, env: null }
  }
  const parts = splitCommandLine(rest)
  return {
    name,
    url: null,
    command: parts[0] || null,
    args: parts.length > 1 ? parts.slice(1) : null,
    env: null,
  }
}

export function formatMcpServerLine(s: McpServerRefData): string {
  if (s.url) return `${s.name} | ${s.url}`
  const cmd = [s.command, ...(s.args || [])].filter(Boolean).join(' ')
  return cmd ? `${s.name} | ${cmd}` : s.name
}

/** Goal 编排进度（后端 GoalInfoDto camelCase 投影）。 */
export interface GoalInfoDto {
  goalId: string
  objective: string
  status: string
  phase: string
  tokenBudget?: number | null
  tokensUsed: number
  elapsedMs: number
  currentSubagentRole?: string | null
  totalWorkerRounds: number
  totalVerifyRounds: number
  liveTurnCount?: number | null
  liveToolCallCount?: number | null
  lastEvent?: string | null
  lastEventDetail?: string | null
  pauseMessage?: string | null
  classifierRunsAttempted?: number | null
  classifierMaxRuns?: number | null
  lastClassifierVerdict?: string | null
  verifyingCompletion?: boolean | null
  planning?: boolean | null
}

/** 工作流运行进度（后端 WorkflowInfoDto camelCase 投影）。 */
export interface WorkflowInfoDto {
  runId: string
  revision: number
  name: string
  objective: string
  status: string
  foreground: boolean
  phases: { title: string; state: string }[]
  currentPhase?: string | null
  agentBudget?: number | null
  agentsUsed: number
  agentsReserved: number
  agentsRemaining?: number | null
  agentUsageIncomplete: boolean
  elapsedMs: number
  activeAgents: number
  currentAgentLabel?: string | null
  agents: {
    agentId: string
    label: string
    phase?: string | null
    model?: string | null
    state: string
    tokensUsed: number
    durationMs: number
    /** 官方能力档：read-only / read-write / execute / all（工作台 Agent 透传） */
    capabilityMode?: string | null
    /** 是否隔离 worktree（工作台 Agent 透传） */
    isolationWorktree?: boolean
  }[]
  lastEvent?: string | null
  lastEventDetail?: string | null
  lastEventTimestamp?: string | null
  pauseMessage?: string | null
  resultSummary?: string | null
}

/**
 * 把面板草稿序列化为组装单 YAML（面板支持的子集）。
 * 供「另存为」写用户级组装单；后端以 YAML 解析并严格校验。
 */
export function compositionToYaml(c: CompositionData): string {
  const lines: string[] = []
  if (c.id) lines.push(`id: ${c.id}`)
  const p = c.persona
  if (p.label || p.sections.length > 0) {
    lines.push('persona:')
    if (p.label) lines.push(`  label: ${JSON.stringify(p.label)}`)
    if (p.sections.length > 0) {
      lines.push('  sections:')
      for (const s of p.sections) lines.push(`    - ${JSON.stringify(s)}`)
    }
  }
  const m = c.model
  if (m.name || m.reasoning_effort) {
    lines.push('model:')
    if (m.name) lines.push(`  name: ${JSON.stringify(m.name)}`)
    if (m.reasoning_effort) lines.push(`  reasoning_effort: ${JSON.stringify(m.reasoning_effort)}`)
  }
  const t = c.tools
  if (t.disable.length > 0) {
    lines.push('tools:')
    lines.push('  disable:')
    for (const name of t.disable) lines.push(`    - ${JSON.stringify(name)}`)
  }
  const s = c.skills
  if (s.scopes.length > 0 || s.exclude.length > 0) {
    lines.push('skills:')
    if (s.scopes.length > 0) {
      lines.push('  scopes:')
      for (const scope of s.scopes) lines.push(`    - ${JSON.stringify(scope)}`)
    }
    if (s.exclude.length > 0) {
      lines.push('  exclude:')
      for (const pat of s.exclude) lines.push(`    - ${JSON.stringify(pat)}`)
    }
  }
  const perm = c.permissions
  if (perm.mode !== 'ask' || perm.rules.length > 0) {
    lines.push('permissions:')
    if (perm.mode !== 'ask') lines.push(`  mode: ${perm.mode}`)
    if (perm.rules.length > 0) {
      lines.push('  rules:')
      for (const r of perm.rules) {
        lines.push(`    - match: ${JSON.stringify(r.match)}`)
        lines.push(`      policy: ${r.policy}`)
      }
    }
  }
  const mcp = c.mcp
  if (mcp.servers.length > 0 || Object.keys(mcp.disabled_tools || {}).length > 0) {
    lines.push('mcp:')
    if (mcp.servers.length > 0) {
      lines.push('  servers:')
      for (const server of mcp.servers) {
        lines.push(`    - name: ${JSON.stringify(server.name)}`)
        if (server.url) lines.push(`      url: ${JSON.stringify(server.url)}`)
        if (server.command) lines.push(`      command: ${JSON.stringify(server.command)}`)
        if (server.args && server.args.length > 0) {
          lines.push('      args:')
          for (const arg of server.args) lines.push(`        - ${JSON.stringify(arg)}`)
        }
      }
    }
    const disabled = Object.entries(mcp.disabled_tools || {})
    if (disabled.length > 0) {
      lines.push('  disabled_tools:')
      for (const [server, tools] of disabled) {
        lines.push(`    ${JSON.stringify(server)}:`)
        for (const t of tools) lines.push(`      - ${JSON.stringify(t)}`)
      }
    }
  }
  const plugins = c.plugins.dirs
  if (plugins.length > 0) {
    lines.push('plugins:')
    lines.push('  dirs:')
    for (const dir of plugins) lines.push(`    - ${JSON.stringify(dir)}`)
  }
  if ((c.flows ?? []).length > 0) {
    lines.push('flows:')
    for (const id of c.flows) lines.push(`  - ${JSON.stringify(id)}`)
  }
  if (c.agent_type?.trim()) {
    lines.push(`agent_type: ${JSON.stringify(c.agent_type.trim())}`)
  }
  return lines.join('\n') + '\n'
}
