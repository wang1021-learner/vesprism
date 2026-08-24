/**
 * Tauri IPC — 严格对齐 Rust commands.rs。
 * 仅在桌面 WebView（有 __TAURI__ / __TAURI_INTERNALS__）中可用。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ModelInfo } from './types'
import type { CompositionData, GoalInfoDto, WorkflowInfoDto } from './lib/composition'

/** 是否运行在 Tauri 桌面壳内（而非普通浏览器） */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
  }
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

// ── Tab 生命周期 ──
export const openTab = () => invoke<string>('open_tab')
export const closeTab = (tabId: string) => invoke('close_tab', { tabId })
export const startPty = (tabId: string, cwd: string, cols: number, rows: number) =>
  invoke('start_pty', { tabId, cwd, cols, rows })
export const ptyWrite = (tabId: string, data: string) =>
  invoke('pty_write', { tabId, data })
export const ptyResize = (tabId: string, cols: number, rows: number) =>
  invoke('pty_resize', { tabId, cols, rows })
export const ptyDetach = (tabId: string) => invoke('pty_detach', { tabId })
export const stopPty = (tabId: string) => invoke('stop_pty', { tabId })
export const restartTab = (tabId: string) => invoke('restart_tab', { tabId })

// ── 工作区 ──
export const workspaceCwd = () => invoke<string>('workspace_cwd')
export const setWorkspaceCwd = (cwd: string) => invoke<string>('set_workspace_cwd', { cwd })
export const scratchCwd = () => invoke<string>('scratch_cwd')

export type PromptAttach = {
  kind: 'file' | 'folder' | 'image'
  path: string
}

export type SecurityPolicyDto = {
  execution_policy: string
  internet_access: string
  file_access: string
  scope: string
  cwd: string
}

export const getSecurityPolicy = (cwd?: string) =>
  invoke<SecurityPolicyDto>('get_security_policy', { cwd: cwd || null })

export const setSecurityPolicy = (policy: SecurityPolicyDto) =>
  invoke<SecurityPolicyDto>('set_security_policy', { policy })

export const enableTabSandbox = (tabId: string) =>
  invoke('enable_tab_sandbox', { tabId })

export const disableTabSandbox = (tabId: string) =>
  invoke('disable_tab_sandbox', { tabId })

export type SandboxStatusDto = {
  active: boolean
  origin_cwd: string
  sandbox_cwd: string
  dirty_count: number
}

export const getSandboxStatus = (tabId: string) =>
  invoke<SandboxStatusDto>('get_sandbox_status', { tabId })

export const syncSandboxToOrigin = (tabId: string) =>
  invoke<{ files: number; message: string }>('sync_sandbox_to_origin', { tabId })

// ── 会话 ──
export type SessionSpawnOpts = {
  modelId?: string | null
  reasoningEffort?: string | null
}

export const startSession = (tabId: string, cwd: string, opts?: SessionSpawnOpts) =>
  invoke('start_session', {
    tabId,
    cwd,
    modelId: opts?.modelId ?? null,
    reasoningEffort: opts?.reasoningEffort ?? null,
  })
export const sendPrompt = (
  tabId: string,
  text: string,
  promptId?: string,
  attachments?: PromptAttach[],
) =>
  invoke('send_prompt', {
    tabId,
    text,
    promptId: promptId ?? crypto.randomUUID(),
    attachments: attachments?.length ? attachments : null,
  })
export const interjectPrompt = (
  tabId: string,
  text: string,
  promptId?: string,
  attachments?: PromptAttach[],
) =>
  invoke('interject_prompt', {
    tabId,
    text,
    promptId: promptId ?? crypto.randomUUID(),
    attachments: attachments?.length ? attachments : null,
  })
export const removeQueuedPrompt = (tabId: string, id: string, expectedVersion?: number) =>
  invoke('remove_queued_prompt', {
    tabId,
    id,
    expectedVersion: expectedVersion ?? 0,
  })
export const editQueuedPrompt = (tabId: string, id: string, newText: string) =>
  invoke('edit_queued_prompt', { tabId, id, newText })

export type SessionCapsDto = {
  recap: boolean
  askMode: boolean
  memory: boolean
  hunks: boolean
  rewind: boolean
  gitWrite: boolean
  imagine: boolean
  schedule: boolean
  queueEdit: boolean
  plugins: boolean
  hooks: boolean
  compact: boolean
}
export const sessionCaps = (tabId: string) => invoke<SessionCapsDto>('session_caps', { tabId })
export const sessionRecap = (tabId: string, auto = false) =>
  invoke<Record<string, unknown>>('session_recap', { tabId, auto })
export const sessionMemoryFlush = (tabId: string) =>
  invoke<Record<string, unknown>>('session_memory_flush', { tabId })
export const sessionMemoryRewrite = (tabId: string, params: Record<string, unknown>) =>
  invoke<Record<string, unknown>>('session_memory_rewrite', { tabId, params })
export const sessionSetMemory = (tabId: string, enabled: boolean) =>
  invoke('session_set_memory', { tabId, enabled })
export const hunkCall = (
  tabId: string,
  action: string,
  params?: Record<string, unknown> | null,
) =>
  invoke<Record<string, unknown>>('hunk_call', {
    tabId,
    action,
    params: params ?? null,
  })
export const pluginsList = (tabId: string) =>
  invoke<Record<string, unknown>>('plugins_list', { tabId })
export const pluginsAction = (tabId: string, action: Record<string, unknown>) =>
  invoke<Record<string, unknown>>('plugins_action', { tabId, action })
export const hooksList = (tabId: string) =>
  invoke<Record<string, unknown>>('hooks_list', { tabId })
export const hooksAction = (tabId: string, action: Record<string, unknown>) =>
  invoke<Record<string, unknown>>('hooks_action', { tabId, action })
export const schedulerDelete = (tabId: string, taskId: string) =>
  invoke<Record<string, unknown>>('scheduler_delete', { tabId, taskId })
export const sessionInfo = (tabId: string) =>
  invoke<Record<string, unknown>>('session_info', { tabId })
export const sessionUsage = (tabId: string) =>
  invoke<Record<string, unknown>>('session_usage', { tabId })
export const compactConversation = (tabId: string, userContext?: string) =>
  invoke<Record<string, unknown>>('compact_conversation', {
    tabId,
    userContext: userContext ?? null,
  })
export const cancelTurn = (tabId: string) => invoke('cancel_turn', { tabId })
export const restartSession = (tabId: string, cwd: string, opts?: SessionSpawnOpts) =>
  invoke('restart_session', {
    tabId,
    cwd,
    modelId: opts?.modelId ?? null,
    reasoningEffort: opts?.reasoningEffort ?? null,
  })

// ── 会话列表 (threads 索引；含 preview) ──
export const listSessions = (cwd: string, limit?: number) =>
  invoke<
    Array<{
      id: string
      title: string
      updated_at: string
      cwd: string
      num_messages?: number
      preview?: string
    }>
  >('list_sessions', {
    cwd,
    limit: limit ?? null,
  })

export type ProjectRow = {
  root: string
  display_name: string
  updated_at_ms: number
}

/** 把仓库根钉进侧栏项目表（不改审批）。 */
export const addProject = (root: string) =>
  invoke<ProjectRow>('add_project', { root })

export const removeProject = (root: string) =>
  invoke<void>('remove_project', { root })

export const listProjects = () => invoke<ProjectRow[]>('list_projects')

export const listSessionsForProject = (root: string, limit?: number) =>
  invoke<
    Array<{
      id: string
      title: string
      updated_at: string
      cwd: string
      num_messages?: number
      preview?: string
    }>
  >('list_sessions_for_project', {
    root,
    limit: limit ?? null,
  })

/** 官方 FTS 搜索会话（标题 + 用户消息）；首次可能 bootstrapping */
export const searchSessions = (
  query: string,
  cwd?: string | null,
  limit?: number,
) =>
  invoke<{
    results: Array<{
      id: string
      title: string
      cwd: string
      updated_at: string
      score: number
      snippet?: string | null
      matched_fields: string[]
    }>
    bootstrapping: boolean
    total_estimate?: number | null
  }>('search_sessions', {
    query,
    cwd: cwd ?? null,
    limit: limit ?? 50,
  })

/** 只读磁盘 transcript 投影消息（不启 agent）— 打开历史主路径 */
export const getSessionMessages = (sessionId: string) =>
  invoke<
    Array<{
      id: string
      role: string
      text: string
      tool?: string | null
      tool_call_id?: string | null
      prompt_id?: string | null
      /** read / edit / execute / search / … */
      kind?: string | null
      status?: string | null
      detail?: string | null
      preview?: string | null
    }>
  >('get_session_messages', { sessionId })

export const loadSession = (
  tabId: string,
  sessionId: string,
  cwd: string,
  restoreCode?: boolean,
  reasoningEffort?: string | null,
) =>
  invoke('load_session', {
    tabId,
    sessionId,
    cwd,
    restoreCode,
    reasoningEffort: reasoningEffort ?? null,
  })
export const forkSession = (tabId: string, cwd: string, newSessionId?: string) =>
  invoke<string>('fork_session', { tabId, cwd, newSessionId })

// ── Rewind（会话历史回滚）──
export type RewindMode = 'all' | 'conversation_only' | 'files_only'
export interface RewindPointInfo {
  prompt_index: number
  created_at: string
  num_file_snapshots: number
  has_file_changes: boolean
  prompt_preview?: string | null
}
export interface RewindConflictInfo {
  path: string
  conflict_type: string
}
export interface RewindResponse {
  success: boolean
  target_prompt_index: number
  mode: RewindMode
  reverted_files: string[]
  clean_files: string[]
  conflicts: RewindConflictInfo[]
  prompt_text?: string | null
  error?: string | null
}
/** 运行中子 agent 快照（x.ai/subagent/list_running；camelCase 对齐后端 DTO） */
export interface RunningSubagentInfo {
  subagentId: string
  parentSessionId: string
  childSessionId: string
  subagentType: string
  description: string
  startedAtEpochMs: number
  durationMs: number
  turnCount: number
  toolCallCount: number
  tokensUsed: number
  contextWindowTokens: number
  contextUsagePct: number
  toolsUsed: string[]
  errorCount: number
}
export const killTask = (tabId: string, taskId: string) =>
  invoke<unknown>('kill_task', { tabId, taskId })
export const listRunningSubagents = (tabId: string) =>
  invoke<RunningSubagentInfo[]>('list_running_subagents', { tabId })

export const getRewindPoints = (tabId: string) =>
  invoke<RewindPointInfo[]>('get_rewind_points', { tabId })
export const executeRewind = (
  tabId: string,
  targetPromptIndex: number,
  mode: RewindMode,
  force: boolean
) => invoke<RewindResponse>('execute_rewind', { tabId, targetPromptIndex, mode, force })

export const deleteSession = (tabId: string, sessionId: string, cwd: string) =>
  invoke('delete_session', { tabId, sessionId, cwd })

export const renameSession = (sessionId: string, cwd: string, title: string) =>
  invoke('rename_session', { sessionId, cwd, title })

// ── 模型 ──
export const setCurrentModel = (tabId: string, modelId: string, reasoningEffort?: string) =>
  invoke('set_current_model', { tabId, modelId, reasoningEffort: reasoningEffort ?? null })

export const getModelSettings = () =>
  invoke<{ default_id: string; models: ModelInfo[]; config_path: string }>('get_model_settings')

export const saveModelSettings = (defaultId: string, models: ModelInfo[]) =>
  invoke('save_model_settings', { defaultId, models })

export const reloadModels = (tabId: string) => invoke('reload_models', { tabId })

export type ProbeModelResult = {
  ok: boolean
  status: number
  message: string
  models: string[]
}

export const probeModelEndpoint = (args: {
  baseUrl: string
  extraHeaders?: Record<string, string>
  queryParams?: Record<string, string>
  envHttpHeaders?: Record<string, string>
  envKey?: string
  apiKey?: string
}) =>
  invoke<ProbeModelResult>('probe_model_endpoint', {
    args: {
      baseUrl: args.baseUrl,
      extraHeaders: args.extraHeaders ?? {},
      queryParams: args.queryParams ?? {},
      envHttpHeaders: args.envHttpHeaders ?? {},
      envKey: args.envKey ?? '',
      apiKey: args.apiKey ?? '',
    },
  })

export type EnginePrefs = {
  session_search: boolean
  memory_enabled: boolean
  web_search_allowed: string[]
  web_search_excluded: string[]
  max_parallel_image_gen_calls: number
  max_parallel_video_gen_calls: number
  combine_queued_prompts: boolean
}

export const getEnginePrefs = () => invoke<EnginePrefs>('get_engine_prefs')
export const setEnginePrefs = (prefs: EnginePrefs) =>
  invoke<EnginePrefs>('set_engine_prefs', { prefs })

export type WorktreeStatusInfo = {
  home: string
  total: number
  alive: number
  dead: number
  db_bytes: number
  available: boolean
  note: string
}

export type WorktreeGcResult = {
  removed: number
  skipped_alive: number
  dry_run: boolean
  message: string
}

export const getWorktreeStatus = () => invoke<WorktreeStatusInfo>('get_worktree_status')
export const gcDesktopWorktrees = (dryRun: boolean) =>
  invoke<WorktreeGcResult>('gc_desktop_worktrees', { dryRun })

export type HookHandler = {
  handler_type: string
  command: string
  url: string
  timeout: number | null
}

export type HookGroup = {
  event: string
  matcher: string
  hooks: HookHandler[]
}

export const listConfigHooks = () => invoke<HookGroup[]>('list_config_hooks')
export const setConfigHooks = (groups: HookGroup[]) =>
  invoke<HookGroup[]>('set_config_hooks', { groups })

// ── 权限 ──
export const respondPermission = (tabId: string, requestId: number, optionId: string) =>
  invoke('respond_permission', { tabId, requestId, optionId })

// ── AI 问卷 ──
export const respondUserQuestion = (
  tabId: string,
  requestId: number,
  responseJson: string,
) => invoke('respond_user_question', { tabId, requestId, responseJson })

export const setSessionMode = (tabId: string, modeId: string) =>
  invoke('set_session_mode', { tabId, modeId })

export const respondExitPlanMode = (
  tabId: string,
  requestId: number,
  responseJson: string,
) => invoke('respond_exit_plan_mode', { tabId, requestId, responseJson })

// ── 子 agent ──
export const cancelSubagent = (tabId: string, subagentId: string) =>
  invoke<Record<string, unknown>>('cancel_subagent', { tabId, subagentId })

export const getSubagent = (
  tabId: string,
  subagentId: string,
  block?: boolean,
  timeoutMs?: number,
) =>
  invoke<Record<string, unknown>>('get_subagent', {
    tabId,
    subagentId,
    block: block ?? false,
    timeoutMs: timeoutMs ?? null,
  })

// ── MCP（官方 x.ai/mcp/*） ──
export const listMcpServers = (tabId: string, cache = true) =>
  invoke<{ servers?: McpServerDto[] } & Record<string, unknown>>('list_mcp_servers', {
    tabId,
    cache,
  })

export const toggleMcpServer = (
  tabId: string,
  serverName: string,
  enabled: boolean,
) =>
  invoke<Record<string, unknown>>('toggle_mcp_server', {
    tabId,
    serverName,
    enabled,
  })

/** 新增/更新 MCP（config 扁平对象，对齐 config.toml） */
export const upsertMcpServer = (
  tabId: string,
  serverName: string,
  config: Record<string, unknown>,
) =>
  invoke<Record<string, unknown>>('upsert_mcp_server', {
    tabId,
    serverName,
    config,
  })

export const deleteMcpServer = (tabId: string, serverName: string) =>
  invoke<Record<string, unknown>>('delete_mcp_server', {
    tabId,
    serverName,
  })

export const toggleMcpTool = (
  tabId: string,
  serverName: string,
  toolName: string,
  enabled: boolean,
) =>
  invoke<Record<string, unknown>>('toggle_mcp_tool', {
    tabId,
    serverName,
    toolName,
    enabled,
  })

export const mcpAuthTrigger = (tabId: string, serverName: string) =>
  invoke<{
    status?: string
    setup?: McpSetupDto | null
    error?: string | null
  }>('mcp_auth_trigger', { tabId, serverName })

export const mcpSetup = (
  tabId: string,
  serverName: string,
  values: Record<string, string>,
) =>
  invoke<{ ok?: boolean }>('mcp_setup', {
    tabId,
    serverName,
    values,
  })

/** 当前会话工具 + 斜杠命令 / 技能（官方 x.ai/commands/list） */
export const listSessionCommands = (tabId: string, cwd?: string | null) =>
  invoke<{
    tools?: string[] | null
    commands?: Array<{
      name?: string
      description?: string
      input?: unknown
      meta?: Record<string, unknown> | null
      _meta?: Record<string, unknown> | null
    }>
  }>('list_session_commands', {
    tabId,
    cwd: cwd ?? null,
  })

/** 自动化工作流列表项（官方 x.ai/workflows/list） */
export type WorkflowDto = {
  name: string
  description?: string
  when_to_use?: string | null
  whenToUse?: string | null
  source?: string
  path?: string | null
}

/** 列出已发现的 Rhai 工作流（官方 x.ai/workflows/list） */
export const listWorkflows = (tabId: string) =>
  invoke<{ workflows?: WorkflowDto[] } & Record<string, unknown>>('list_workflows', {
    tabId,
  })

/** 未收编官方扩展的逃生口。面板新功能走具名命令，不要再喊 x.ai/*。 */
export const sessionExt = (
  tabId: string,
  method: string,
  params?: Record<string, unknown> | null,
) =>
  invoke<Record<string, unknown>>('session_ext', {
    tabId,
    method,
    params: params ?? null,
  })

export type McpSetupFieldDto = {
  id: string
  label: string
  type?: string
  required?: boolean
  default?: string | null
  options?: Array<{ label: string; value: string }>
}

export type McpSetupDto = {
  fields?: McpSetupFieldDto[]
}

/** 与官方 McpServerEntry 对齐的前端 DTO（字段宽松） */
export type McpServerDto = {
  name: string
  displayName?: string | null
  display_name?: string | null
  source?: string
  sourceLabel?: string | null
  source_label?: string | null
  type?: string
  url?: string
  command?: string
  args?: string[]
  env?: Array<{ name?: string; value?: string }> | Record<string, string>
  setup?: McpSetupDto | null
  session?: {
    enabled?: boolean
    status?: string | null
    tools?: Array<{
      name: string
      displayName?: string | null
      display_name?: string | null
      description?: string | null
      enabled?: boolean
    }>
    authRequired?: boolean
    auth_required?: boolean
    setupRequired?: boolean
    setup_required?: boolean
  } | null
}

// ── 密钥 ──
export const getEnvStatus = (keyName: string) =>
  invoke<{ key_name: string; is_set: boolean }>('get_env_status', { keyName })

export const saveEnvKey = (keyName: string, value: string) =>
  invoke('save_env_key', { keyName, value })

export const envFileLocation = () => invoke<string>('env_file_location')

// ── 文件 ──

export const listDir = (path: string) =>
  invoke<Array<{ name: string; is_dir: boolean }>>('list_dir', { path })

export const searchWorkspaceFiles = (
  root: string,
  query: string,
  limit?: number,
) =>
  invoke<Array<{ path: string; rel: string; is_dir: boolean }>>(
    'search_workspace_files',
    { root, query, limit: limit ?? 24 },
  )

export const savePasteImage = (base64: string, mime: string) =>
  invoke<string>('save_paste_image', { base64, mime })

export const readFileText = (path: string) =>
  invoke<string>('read_file_text', { path })

export const readMemoryFile = (path: string) =>
  invoke<string>('read_memory_file', { path })

export const deleteMemoryPath = (path: string, source: string) =>
  invoke('delete_memory_path', { path, source })

/** 右栏「差异」：工作区文件相对 git HEAD */
export type FileWorkingDiff = {
  path: string
  old_text: string
  new_text: string
  status: 'clean' | 'modified' | 'untracked' | 'not_git' | 'missing' | string
  message?: string | null
}

export const fileWorkingDiff = (path: string, tabId?: string) =>
  invoke<FileWorkingDiff>('file_working_diff', { path, tabId })

export interface WorkspaceChange {
  path: string
  status: 'modified' | 'untracked' | 'deleted' | 'renamed' | string
}

export const workspaceChanges = (tabId?: string) =>
  invoke<WorkspaceChange[]>('workspace_changes', { tabId })

export type SkillInfoDto = {
  name: string
  displayName?: string | null
  display_name?: string | null
  description?: string
  whenToUse?: string | null
  when_to_use?: string | null
  shortDescription?: string | null
  short_description?: string | null
  argumentHint?: string | null
  argument_hint?: string | null
  path: string
  scope?: string
  pluginName?: string | null
  plugin_name?: string | null
  enabled?: boolean
  userInvocable?: boolean
  user_invocable?: boolean
  disableModelInvocation?: boolean
  disable_model_invocation?: boolean
  allowedTools?: string[] | null
  allowed_tools?: string[] | null
  configSource?: { type?: string } | null
  config_source?: { type?: string } | null
}

/** 设置页全量目录：不绑会话，读盘 / config.toml */
export const listCatalogMcp = () =>
  invoke<{ servers?: McpServerDto[] }>('list_catalog_mcp')

export const listCatalogSkills = (cwd?: string | null) =>
  invoke<{ skills?: SkillInfoDto[] }>('list_catalog_skills', { cwd: cwd ?? null })

export const listCatalogMemory = () =>
  invoke<{ files?: Array<{ path: string; source: string; sizeBytes: number }> }>(
    'list_catalog_memory',
  )

export const listCatalogPlugins = (cwd?: string | null) =>
  invoke<{ plugins?: unknown[] }>('list_catalog_plugins', { cwd: cwd ?? null })

export const listSkills = (tabId: string, cwd: string) =>
  invoke<{ skills?: SkillInfoDto[] }>('list_skills', { tabId, cwd })

export const addSkill = (tabId: string, path: string, cwd: string) =>
  invoke<{ message?: string; skills?: SkillInfoDto[] }>('add_skill', {
    tabId,
    path,
    cwd,
  })

export const removeSkill = (tabId: string, path: string, cwd: string) =>
  invoke<{ message?: string; skills?: SkillInfoDto[] }>('remove_skill', {
    tabId,
    path,
    cwd,
  })

export const toggleSkill = (
  tabId: string,
  name: string,
  enabled: boolean,
  cwd: string,
) =>
  invoke<{ skills?: SkillInfoDto[] }>('toggle_skill', {
    tabId,
    name,
    enabled,
    cwd,
  })

// ── 组装单（半插件化 P0）──
export const applyComposition = (
  tabId: string,
  sessionId: string | null,
  composition: CompositionData,
) => invoke('apply_composition', { tabId, sessionId, composition })

export const getComposition = (sessionId: string | null, cwd: string) =>
  invoke<CompositionData>('get_composition', { sessionId, cwd })

export const saveComposition = (name: string, yaml: string) =>
  invoke('save_composition', { name, yaml })

export type CompositionPresetDto = {
  id: string
  model?: string | null
  agentType?: string | null
}

export const listCompositions = () => invoke<CompositionPresetDto[]>('list_compositions')

// ── 流式事件（与后端 FrontendEvent snake_case tag 对齐）──
export interface SessionEventPayload {
  type: string
  tab_id: string
  text?: string
  prompt_id?: string | null
  stop_reason?: string
  message?: string
  debug?: string
  origin_cwd?: string
  sandbox_cwd?: string
  /** ToolCallInfo camelCase */
  tool?: {
    toolCallId?: string
    kind?: string
    status?: string
    title?: string
    detail?: string
    preview?: string
    diffs?: unknown[]
    /** 兼容错误字段 */
    name?: string
    call_id?: string
    input?: Record<string, unknown>
  }
  /** ToolCallUpdateInfo camelCase */
  update?: {
    toolCallId?: string
    kind?: string | null
    status?: string | null
    title?: string | null
    detail?: string | null
    preview?: string | null
    diffs?: unknown[] | null
    call_id?: string
    output?: string
  }
  request_id?: number
  description?: string
  options?: { id: string; name: string; kind?: string }[]
  server_name?: string
  requested_schema?: unknown
  url?: string
  elicitation_id?: string
  status?: string
  session_id?: string
  total_tokens?: number
  /** 会话标题更新（引擎 LLM 生成 / 手动改名） */
  title?: string
  /** x.ai/queue/changed */
  entries?: Array<{ id?: string; version?: number; text?: string; position?: number }>
  running_prompt_id?: string | null
  running_text?: string | null
  /** TabActor 重建次数（tab_recovering） / 连续 panic 次数（tab_failed） */
  attempt?: number
  attempts?: number
  /** RetryInProgress：自动重试进度 */
  max_retries?: number
  reason?: string
  /** git_head_changed：官方 git HEAD 变化通知 */
  branch?: string | null
  // ── 权限请求安全预检发现（x.ai/security_findings token 列表）──
  security_findings?: string[]
  // ── task_backgrounded：bash 命令转入后台 ──
  task_id?: string
  command?: string
  output_file?: string
  monitor_description?: string | null
  // ── 子 agent ──
  subagent_id?: string
  parent_session_id?: string
  child_session_id?: string
  subagent_type?: string
  model?: string | null
  duration_ms?: number
  turn_count?: number
  tool_call_count?: number
  tokens_used?: number
  context_usage_pct?: number
  tools_used?: string[]
  error_count?: number
  tool_calls?: number
  turns?: number
  error?: string | null
  output?: string | null
  // ── AI 问卷 ──
  tool_call_id?: string
  mode?: string
  questions?: Array<{
    question: string
    options: Array<{ label: string; description?: string; preview?: string | null }>
    multiSelect?: boolean | null
  }>
  /** CurrentModeUpdate / exit_plan_mode */
  mode_id?: string
  plan_content?: string | null
  // ── Goal / 工作流进度（后端 camelCase DTO）──
  goal?: GoalInfoDto
  workflow?: WorkflowInfoDto
  // ── 客户端终端（ACP 终端能力）──
  terminal_id?: string
  exit_code?: number | null
  signal?: string | null
  truncated?: boolean
  killed?: boolean
  /** 官方 MCP 推送 */
  method?: string
  payload?: Record<string, unknown>
  files?: Array<{
    path?: string
    source?: string
    sizeBytes?: number
    size_bytes?: number
    modifiedEpochSecs?: number | null
    modified_epoch_secs?: number | null
  }>
  kind?: string
  result?: string
  path?: string | null
  op?: string
  prompt?: string
  human_schedule?: string
  next_fire_at?: string | null
  summary?: string
  auto?: boolean
  event_text?: string
}

let _unlisten: UnlistenFn | null = null

export async function listenSessionEvents(
  handler: (event: SessionEventPayload) => void
): Promise<() => void> {
  _unlisten?.()
  _unlisten = await listen<SessionEventPayload>('session-event', (e) => handler(e.payload))
  return () => {
    _unlisten?.()
    _unlisten = null
  }
}
