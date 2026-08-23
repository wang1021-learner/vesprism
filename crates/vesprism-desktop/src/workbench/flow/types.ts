/**
 * 流程画布数据模型。
 * 草稿含坐标；发布包只有官方 sidecar 两文件：`<id>.rhai` + `<id>.flow.yaml`。
 * 坐标永不进包；flow 节点在发布时内联，包内不再引用其他流程。
 */

export const FLOW_NODE_TYPES = [
  'start',
  'agent',
  'tool',
  'http',
  'database',
  'knowledge',
  'variable',
  'transform',
  'loop',
  'loop_end',
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
  /** 官方 AgentOpts.max_output_tokens：单次 agent 输出上限（token 数）。空 = 不传。 */
  maxOutputTokens?: number
  /** 失败自动重试次数（编译成 Rhai 循环，0 = 不重试）。 */
  retry?: number
  /** 整个 agent 调用墙钟超时（秒），编译进官方 AgentOpts.timeout_ms 真超时。0 = 不设。 */
  timeoutSecs?: number
}

export interface ToolParams {
  label?: string
  toolName?: string
  command?: string
  args?: Record<string, unknown>
  /** 失败自动重试次数（编译成 Rhai 循环，0 = 不重试）。 */
  retry?: number
  /** 执行超时（秒），编译进任务说明由执行 agent 落实（指令级）。0 = 不设。 */
  timeoutSecs?: number
  /** 输出 JSON Schema（编译进 AgentOpts.output_schema，官方按它结构化+重试）。 */
  outputSchema?: JsonSchema
}

export interface HttpParams {
  label?: string
  url?: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  /** 请求头（每行一个 `Name: value`，或 JSON 对象文本） */
  headers?: string
  /** 请求体（JSON 文本） */
  body?: string
  /** 失败自动重试次数（编译成 Rhai 循环，0 = 不重试）。 */
  retry?: number
  /** 请求超时（秒），编译进任务说明由执行 agent 落实（指令级）。0 = 不设。 */
  timeoutSecs?: number
  /** 输出 JSON Schema（编译进 AgentOpts.output_schema，官方按它结构化+重试）。 */
  outputSchema?: JsonSchema
}

/** 变量/常量节点：value 支持 {{prev.output}} / {{input}} 运行时引用。 */
export interface VariableParams {
  label?: string
  /** 常量值或含 {{变量}} 的表达式文本 */
  value?: string
  /** 无 {{}} 时的常量解释方式 */
  valueType?: 'string' | 'number' | 'boolean' | 'json'
}

/** 数据库查询节点：走内置 MCP 工具 database_query（SQLite，真执行）。 */
export interface DatabaseParams {
  label?: string
  /** SQL 语句 */
  sql?: string
  /** SQLite 文件路径；空 = 默认库 ~/.vesprism/mcp/db.sqlite */
  dbPath?: string
  /** 失败自动重试次数（0 = 不重试）。 */
  retry?: number
}

/** 知识库检索节点：走内置 MCP 工具 knowledge_search（FTS5 全文检索）。 */
export interface KnowledgeParams {
  label?: string
  /** 知识库名 = ~/.vesprism/knowledge/<名>/ 目录 */
  knowledgeBase?: string
  /** 检索词（FTS5 语法） */
  query?: string
  /** 最多返回片段数，默认 5 */
  limit?: number
  /** 失败自动重试次数（0 = 不重试）。 */
  retry?: number
}

/** 代码/Transform 节点：Rhai 表达式，用 input 引用上游输出。 */
export interface TransformParams {
  label?: string
  /** Rhai 表达式，如 input.items.map(|x| #{ name: x.name })；`input` = 上一步输出 */
  code?: string
}

/** For-Each 迭代：loop → 单一循环体节点 → loop_end。循环体内 {{prev.output}} 指当前元素。 */
export interface LoopParams {
  label?: string
}

/** 迭代汇聚：输出收集后的结果数组。 */
export interface LoopEndParams {
  label?: string
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
  | HttpParams
  | DatabaseParams
  | KnowledgeParams
  | VariableParams
  | TransformParams
  | LoopParams
  | LoopEndParams
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

/** 模型局部改图。update_nodes.params 与现有 params 浅合并。 */
export interface FlowGraphPatch {
  update_nodes?: Array<{ id: string; params: Record<string, unknown> }>
  add_nodes?: FlowGraphJson['nodes']
  remove_nodes?: string[]
  add_edges?: FlowGraphJson['edges']
  remove_edges?: Array<{ from: string; to: string }>
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
  /** 节点里引用的编制 id；列表扫描用，避免逐条 getFlow。 */
  preset_ids?: string[]
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
