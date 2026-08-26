/**
 * Vesprism 桌面端 — 共享类型
 */

/** 工具调用中的结构化 diff（与后端 ToolDiffInfo camelCase 对齐） */
export type ToolDiffData = {
  path: string
  oldText?: string | null
  newText: string
}

/** 工具调用数据（与后端 ToolCallInfo camelCase 对齐） */
export type ToolCallData = {
  toolCallId: string
  /** read / edit / execute / search / fetch / delete / move / think / other */
  kind: string
  /** pending / in_progress / completed / failed */
  status: string
  title: string
  /** 路径、命令等摘要 */
  detail: string
  /** 输出预览（截断） */
  preview: string
  diffs?: ToolDiffData[]
  /** 前端计时（耗时展示） */
  timing?: { start: number; end?: number }
  /** todo_write 快照（清单卡渲染） */
  todo?: TodoSnapshotData | null
}

export interface TodoSnapshotData {
  summary: string
  todos: { content: string; status: string }[]
}

export type ToolCallUpdateData = {
  toolCallId: string
  kind?: string | null
  status?: string | null
  title?: string | null
  detail?: string | null
  preview?: string | null
  diffs?: ToolDiffData[] | null
  /** todo_write 快照（清单卡渲染） */
  todo?: TodoSnapshotData | null
}

export type MessageAttach = {
  kind: 'file' | 'folder' | 'image'
  path: string
  /** 本次进程内预览（blob:）；历史重开会走路径 */
  previewUrl?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'thought' | 'tool'
  text: string
  /** 用户气泡里的附件（图要画出来，不要只写文件名） */
  attachments?: MessageAttach[]
  /** @deprecated 用 toolCall.title；兼容磁盘投影 */
  tool?: string
  toolCallId?: string
  /** 完整工具快照（实时事件） */
  toolCall?: ToolCallData
  /** 用户消息关联的 prompt（用于分片合并 / 乐观 UI） */
  promptId?: string
  isStreaming?: boolean
  thoughtTiming?: { start: number; end?: number }
}

export interface PermissionOption {
  id: string
  name: string
  /** 官方 ACP：allow_once / allow_always / reject_once / reject_always；旧回退 allow | deny | other */
  kind?: string
}

/** 客户端终端运行态（ACP 终端能力；key=terminalId） */
export interface TerminalRuntime {
  terminalId: string
  /** 启动命令（terminal_opened 携带） */
  command: string
  /** 累计输出（卡片只留末尾 64KB） */
  text: string
  truncated: boolean
  exitCode?: number | null
  signal?: string | null
  /** 已被 kill（超时/中断），不是命令自己非零退出 */
  killed?: boolean
  /** 已退出 */
  exited: boolean
  openedAt: number
  expanded: boolean
}

export interface PermissionRequest {
  id: string
  /** 原始 description（调试 / 兜底） */
  tool: string
  options: PermissionOption[]
  /** 解析后的类型文案，如「运行终端命令」 */
  kindLabel?: string
  /** 短标题（已去 Execute `…` 外壳） */
  title?: string
  /** 完整命令或目标路径 */
  command?: string
  /** 一行摘要（截断） */
  summary?: string
  /** 安全预检发现（官方 token：opaque_shell / dangerous_command 等） */
  securityFindings?: string[]
}

/** AI 问卷选项（与后端 UserQuestionOption camelCase 对齐） */
export interface UserQuestionOption {
  label: string
  description?: string
  preview?: string | null
}

/** 单道问卷题 */
export interface UserQuestionItem {
  question: string
  options: UserQuestionOption[]
  multiSelect?: boolean | null
}

/** MCP 征求（官方 x.ai/mcp/elicit） */
export interface McpElicitRequest {
  requestId: number
  toolCallId: string
  serverName: string
  message: string
  mode: 'form' | 'url'
  requestedSchema?: unknown
  url?: string
  elicitationId?: string
  /** 本地点过同意之后，等 elicit_complete */
  waiting?: boolean
}

export interface UserQuestionRequest {
  requestId: number
  toolCallId: string
  /** default | plan */
  mode: string
  questions: UserQuestionItem[]
}

/** 计划模式生命周期（对齐官方 Inactive / Pending / Active / ExitPending） */
export type PlanPhase = 'off' | 'pending' | 'active' | 'exit_pending'

/** 挂起的退出计划审批（前端 TabState） */
export interface ExitPlanModeRequest {
  requestId: number
  toolCallId: string
  planContent: string
  hasPlan: boolean
}

/** 计划稿行批注（行号从 1 起、含两端） */
export interface PlanComment {
  id: string
  startLine: number
  endLine: number
  text: string
}

/** 问卷提交载荷（回传 JSON outcome） */
export type UserQuestionResponsePayload =
  | {
      outcome: 'accepted'
      answers: Record<string, string[]>
      annotations?: Record<string, { preview?: string; notes?: string }>
    }
  | { outcome: 'chat_about_this'; partial_answers?: Record<string, string> }
  | { outcome: 'skip_interview'; partial_answers?: Record<string, string> }
  | { outcome: 'cancelled' }

/** 子 agent 运行时状态（会话内 scaffold 行 + TabState.subagents） */
export type SubagentRuntime = {
  subagentId: string
  parentSessionId: string
  childSessionId: string
  subagentType: string
  description: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  model?: string | null
  durationMs?: number
  turnCount?: number
  toolCallCount?: number
  tokensUsed?: number
  contextUsagePct?: number
  toolsUsed?: string[]
  errorCount?: number
  error?: string | null
  output?: string | null
}

/**
 * 解析 grok-session `format_permission_description`。
 * 兼容多行与被压成一行的文案（IPC/显示层可能吞换行）。
 */
export function parsePermissionDescription(raw: string): {
  kindLabel: string
  title: string
  command: string
  summary: string
} {
  const text = (raw || '').trim()
  if (!text) {
    return { kindLabel: '工具操作', title: '', command: '', summary: '' }
  }

  // 先尽量还原多行：在「类型/工具/命令/目标」标签前插入换行
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/(?<!^)\s*(?=(?:类型|工具|命令|目标)：)/g, '\n')

  let kindLabel = ''
  let title = ''
  const commandLines: string[] = []
  let collecting: 'command' | 'target' | null = null

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('类型：')) {
      kindLabel = trimmed.slice(3).trim()
      collecting = null
      continue
    }
    if (trimmed.startsWith('工具：')) {
      title = trimmed.slice(3).trim()
      collecting = null
      continue
    }
    if (trimmed.startsWith('命令：') || trimmed.startsWith('目标：')) {
      collecting = trimmed.startsWith('命令') ? 'command' : 'target'
      const rest = trimmed.slice(3).trim()
      if (rest) commandLines.push(rest)
      continue
    }
    if (collecting) {
      commandLines.push(line)
    }
  }

  let command = commandLines.join('\n').trim()

  // Execute `…`（可能跨行）→ 纯命令
  const peelExecute = (s: string): string | null => {
    const m = s.match(/^Execute\s+`([\s\S]*)`\s*$/i)
    return m ? m[1].trim() : null
  }

  const fromTitle = peelExecute(title)
  if (fromTitle) {
    if (!command) command = fromTitle
    title = ''
  }

  // 整段里直接找 Execute `…`
  if (!command) {
    const m = text.match(/Execute\s+`([\s\S]*?)`/i)
    if (m) command = m[1].trim()
  }

  // 类型未解析时，从关键字猜
  if (!kindLabel) {
    if (/运行终端|Execute|Get-PS|powershell|bash|cmd/i.test(text)) {
      kindLabel = '运行终端命令'
    } else if (/读取|read/i.test(text)) {
      kindLabel = '读取文件'
    } else if (/编辑|edit|write/i.test(text)) {
      kindLabel = '编辑文件'
    } else {
      kindLabel = '工具操作'
    }
  }

  if (command && title && title.includes(command.slice(0, Math.min(40, command.length)))) {
    title = ''
  }

  // 摘要：短命令预览；绝不回退成「类型：…工具：…」整坨
  let summary = ''
  if (command) {
    const one = command.replace(/\s+/g, ' ').trim()
    summary = one.length > 64 ? `${[...one].slice(0, 64).join('')}…` : one
  } else if (title && !/^类型：/.test(title) && !title.includes('工具：')) {
    summary = title.length > 64 ? `${title.slice(0, 64)}…` : title
  }

  return { kindLabel, title, command, summary }
}

/** 对齐后端 ModelEntryDto（serde snake_case） */
export interface ModelInfo {
  id: string
  name: string
  model: string
  base_url: string
  env_key: string
  context_window: number
  system_prompt_label: string
  api_backend: string
  description: string
  temperature: number | null
  top_p: number | null
  max_completion_tokens: number | null
  extra_headers: Record<string, string>
  /** 官方 query_params：附加到每次请求 URL */
  query_params: Record<string, string>
  /** 官方 env_http_headers：请求头名 → 环境变量名 */
  env_http_headers: Record<string, string>
  api_base_url: string
  max_retries: number
  inference_idle_timeout_secs: number
  stream_tool_calls: boolean | null
  agent_type: string
  use_concise: boolean
  auto_compact_threshold_percent: number
  supports_reasoning_effort: boolean
  reasoning_effort: string
  hidden: boolean
  supported_in_api: boolean
  laziness_enabled: boolean
  laziness_max_nudges: number
  compactions_remaining: string
  compaction_at_tokens: string
  provider?: string
}

export type SessionStatus = 'unknown' | 'initializing' | 'idle' | 'generating' | 'ended'

export type SessionPhase = 'idle' | 'booting' | 'ready' | 'restarting' | 'loading' | 'failed'

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const REASONING_LEVELS: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: '关闭' },
  { value: 'minimal', label: '最低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '很高' },
  { value: 'max', label: '最高' },
]
