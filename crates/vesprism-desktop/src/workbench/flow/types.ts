/**
 * 流程画布数据模型。
 * 草稿含坐标；发布包只有官方 sidecar 两文件：`<id>.rhai` + `<id>.flow.yaml`。
 * 坐标永不进包；flow 节点在发布时内联，包内不再引用其他流程。
 */

export const FLOW_NODE_TYPES = [
  'start',
  'agent',
  'tool',
  'flow',
  'branch',
  'parallel',
  'join',
  'end',
] as const
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number]

export type JsonSchema = Record<string, unknown>

export interface SchemaField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  description?: string
}

export interface StartParams {
  label?: string
  fields?: SchemaField[]
  inputSchema?: JsonSchema
}

export interface AgentParams {
  label?: string
  /** 工作台 Agent id；发布时解析成 AgentOpts，不写进提示词 */
  presetId?: string
  role?: string
  /** 空 = 用 Agent 的模型，再空 = 继承会话 */
  model?: string
  /** 官方 AgentOpts.agent_type；空 = 用 Agent 源，再空 = general-purpose。不进画布。 */
  agentType?: string
  prompt?: string
}

export interface ToolParams {
  label?: string
  toolName?: string
  command?: string
  args?: Record<string, unknown>
}

export interface FlowRefParams {
  label?: string
  flowId?: string
  input?: Record<string, unknown>
}

export interface BranchParams {
  label?: string
  condition?: 'success' | 'failure' | 'expression'
  expression?: string
}

export interface ParallelParams {
  label?: string
  mode?: 'all' | 'race'
}

export interface JoinParams {
  label?: string
  mergeMode?: 'merge_json' | 'list' | 'all_success'
}

export interface EndParams {
  label?: string
  outputSchema?: JsonSchema
}

export type FlowNodeParams =
  | StartParams
  | AgentParams
  | ToolParams
  | FlowRefParams
  | BranchParams
  | ParallelParams
  | JoinParams
  | EndParams

export interface FlowGraphNode {
  id: string
  type: FlowNodeType
  params: FlowNodeParams
  /** 仅草稿；发布进包时必须剥掉 */
  position?: { x: number; y: number }
}

export interface FlowGraphEdge {
  id?: string
  from: string
  to: string
  label?: string
  sourceHandle?: string
  targetHandle?: string
}

/** AI / 流程包 graph.json 契约（无坐标） */
export interface FlowGraphJson {
  nodes: Array<{ id: string; type: FlowNodeType; params: FlowNodeParams }>
  edges: Array<{
    from: string
    to: string
    label?: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

export interface FlowDraft {
  id: string
  name: string
  description: string
  version: string
  input_schema: JsonSchema
  output_schema: JsonSchema
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
  dirty?: boolean
  published?: boolean
  publishedVersion?: string
}

export interface FlowYamlMeta {
  id: string
  name: string
  description: string
  input_schema: JsonSchema
  output_schema: JsonSchema
  version: string
  /** 官方 sidecar 仍带此字段；v1 发布内联后恒为空，不是运行时依赖。 */
  dependencies: string[]
}

export interface FlowListItem {
  id: string
  name: string
  description: string
  version: string
  published: boolean
  draft: boolean
  dependencies: string[]
}

export interface FlowRecord extends FlowListItem {
  input_schema: JsonSchema
  output_schema: JsonSchema
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
  rhai?: string
  prompts?: string
}

export type ImportConflictMode = 'overwrite' | 'keep-both' | 'cancel'

export interface FlowRequirements {
  models: string[]
  tools: string[]
}

export type ImportFlowResult =
  | {
      status: 'ok'
      id: string
      version: string
      requirements?: FlowRequirements
      missing_tools?: string[]
      missingTools?: string[]
    }
  | {
      status: 'conflict'
      id: string
      existing_version: string
      incoming_version: string
      requirements?: FlowRequirements
    }
  | { status: 'missing_deps'; id: string; missing: string[] }
  | { status: 'cancelled' }

export interface FlowRunStep {
  nodeId: string
  label: string
  type: FlowNodeType
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: string
  startedAt?: number
  endedAt?: number
}

export const FLOW_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidFlowId(id: string): boolean {
  const s = id.trim()
  return s.length >= 1 && s.length <= 64 && FLOW_ID_RE.test(s)
}

export function slugifyFlowId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'untitled-flow'
}
