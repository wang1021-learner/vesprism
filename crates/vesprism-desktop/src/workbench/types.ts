/** 工作台 Agent 资产。与聊天区 CompositionData 不是同一套。 */

export type AgentCapability = 'read_only' | 'read_write' | 'execute' | 'all'

export const AGENT_CAPABILITY_LABEL: Record<AgentCapability, string> = {
  read_only: '只读',
  read_write: '可改文件',
  execute: '能跑命令',
  all: '全权',
}

export const AGENT_CAPABILITY_OFFICIAL: Record<AgentCapability, string> = {
  read_only: 'read-only',
  read_write: 'read-write',
  execute: 'execute',
  all: 'all',
}

export interface AgentPersona {
  label?: string | null
  sections: string[]
}

export interface AgentRecord {
  id: string
  name: string
  description: string
  version: string
  model?: string | null
  capability?: AgentCapability | null
  isolation: boolean
  disabled_tools: string[]
  // per-agent deny 规则（`kind:glob` 或 `glob`，如 `edit:**/.env`）
  permission_rules: string[]
  persona: AgentPersona
  input_contract: string
  output_contract: string
  output_schema?: unknown | null
  agent_type?: string | null
  skills?: string[]
  flows: string[]
}

export interface AgentListItem {
  id: string
  name: string
  description?: string
  version: string
  model?: string | null
  capability?: AgentCapability | null
  isolation: boolean
  disabledTools?: string[]
  disabled_tools?: string[]
  permissionRules?: string[]
  permission_rules?: string[]
  agentType?: string | null
  agent_type?: string | null
  outputSchema?: unknown | null
  output_schema?: unknown | null
  skills?: string[]
  systemPrompt?: string
  system_prompt?: string
  error?: string | null
}

export interface AgentDetail {
  agent: AgentRecord
  systemPrompt?: string
  system_prompt?: string
}

export function emptyAgent(id = '', name = ''): AgentRecord {
  return {
    id,
    name,
    description: '',
    version: '1',
    model: null,
    capability: null,
    isolation: false,
    disabled_tools: [],
    permission_rules: [],
    persona: { label: null, sections: [] },
    input_contract: '',
    output_contract: '',
    output_schema: null,
    agent_type: null,
    skills: [],
    flows: [],
  }
}

export const AGENT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidAgentId(id: string): boolean {
  const s = id.trim()
  return s.length >= 1 && s.length <= 64 && AGENT_ID_RE.test(s)
}

export function slugifyAgentId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'untitled-agent'
}
