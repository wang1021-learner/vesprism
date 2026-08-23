/**
 * nanostores 状态 — Vesprism 桌面端
 *
 * 多会话分片（2026-08）：
 * - `tabStates: Map<tabId, TabState>` 是唯一事实源（对齐官方 pager 的
 *   `AppView.agents: IndexMap<AgentId, AgentView>` 模式）。
 * - 下方所有 `$xxx` 全局 atom 保留为「当前 tab 的投影」，组件读点零改动。
 * - 所有写点必须走 `patchTab` / `patchActiveTab`（写 map + 活跃投影），
 *   严禁直接 set 全局 atom 绕过 map。
 */
import { atom, computed } from 'nanostores'
import type {
  ChatMessage,
  ModelInfo,
  PermissionRequest,
  SessionPhase,
  SessionStatus,
  SubagentRuntime,
  TerminalRuntime,
  UserQuestionRequest,
  ExitPlanModeRequest,
  PlanPhase,
} from './types'
import { upsertSubagentMessage } from './lib/subagentMessage'
import type { SecurityPolicy } from './lib/executionPolicy'
import { DEFAULT_SECURITY_POLICY } from './lib/executionPolicy'
import type { GoalInfoDto, WorkflowInfoDto } from './lib/composition'


// ── Tab 分片 ──────────────────────────────────────────────────────────

/** 单个 tab 的会话状态（字段语义对齐官方 RosterEntry：sessionId/title/cwd/modelId/activity） */
/** bash 后台任务（官方 x.ai/task_backgrounded；key=toolCallId） */
export interface BackgroundTaskInfo {
  taskId: string
  command: string
  outputFile?: string
  monitorDescription?: string | null
  description?: string | null
}

export interface TabState {
  /** 引擎会话 id（原 $activeSessionId） */
  sessionId: string
  /** 侧栏高亮会话 id（原 $activeChatId） */
  chatId: string
  /** 消息列表（原 $messages） */
  messages: ChatMessage[]
  /** 引擎状态（原 $engineStatus） */
  status: SessionStatus
  /** 会话壳阶段（原 $sessionPhase） */
  phase: SessionPhase
  /** 权限请求（原 $permission） */
  permission: PermissionRequest | null
  /** 挂起的 AI 问卷 */
  userQuestion: UserQuestionRequest | null
  /** 计划模式生命周期 */
  planPhase: PlanPhase
  /** 挂起的计划稿审批 */
  planApproval: ExitPlanModeRequest | null
  /** 预览卡是否打开（审批中或 /view-plan） */
  planPreviewOpen: boolean
  /** 最近一份计划稿（交稿或只读重开） */
  lastPlanContent: string
  lastPlanHasBody: boolean
  lastPlanToolCallId: string
  /** 当前会话下的子 agent 列表 */
  subagents: SubagentRuntime[]
  /** 顶部标题（原 $chatTitle） */
  chatTitle: string
  /** 输入框草稿（原 $composerInput） */
  composerInput: string
  /** 工作区 cwd（原 $workspaceCwd） */
  cwd: string
  /** 错误 banner（原 $error） */
  error: string
  /** 本 tab 当前模型 id */
  modelId: string
  /** 本 tab 推理强度 */
  reasoningEffort: string
  /** bash 后台任务（key=toolCallId → 任务信息；活跃 tab 投影到 $backgroundTasks） */
  backgroundTasks: Record<string, BackgroundTaskInfo>
  /**
   * 专用面板 Tab：mcp / skills / tools / workflows / flow-canvas / agents；null=普通对话。
   * 侧栏入口打开时写入，主区据此切换面板而非空白会话。
   */
  utilityKind: UtilityKind | null
  /** 画布当前编辑的流程 id（flow-canvas tab；组件卸载重挂载时据此恢复，避免回落 demo） */
  flowId?: string
  /** 隔离 worktree 绝对路径；空=未沙箱 */
  sandboxCwd: string
  /** 沙箱对应的主工作区 */
  sandboxOrigin: string
  /** Goal 编排进度（官方 GoalUpdated；status=cleared 时置 null） */
  goal: GoalInfoDto | null
  /** 工作流运行进度（key=runId，最新覆盖） */
  workflows: Record<string, WorkflowInfoDto>
  /** 客户端终端运行态（key=terminalId；ACP 终端能力） */
  terminals: Record<string, TerminalRuntime>
  /** 官方 prompt 队列（尚未开跑的 follow-up） */
  queuedPrompts: QueuedPrompt[]
  /** 最近一次 token_usage（上下文用量条） */
  totalTokens: number
  /** 官方 MemoryFiles */
  memoryFiles: MemoryFileInfo[]
  /** 本会话定时任务 */
  scheduledTasks: ScheduledTaskInfo[]
}

export type MemoryFileInfo = {
  path: string
  source: string
  sizeBytes: number
  modifiedEpochSecs?: number | null
}

export type ScheduledTaskInfo = {
  taskId: string
  prompt: string
  humanSchedule: string
  nextFireAt?: string | null
  lastFiredAt?: string | null
  fireCount?: number
  /** 已发 /loop、引擎 ScheduledTaskCreated 还没到 */
  pending?: boolean
}

export type QueuedPrompt = {
  id: string
  version: number
  text: string
  position: number
}

/** 侧栏工具入口对应的专用面板类型 */
export type UtilityKind =
  | 'mcp'
  | 'skills'
  | 'tools'
  | 'workflows'
  | 'flow-canvas'
  | 'flow-run'
  | 'agents'
  | 'memory'
  | 'plugins'

export function emptyTabState(): TabState {
  return {
    sessionId: '',
    chatId: '',
    messages: [],
    status: 'unknown',
    phase: 'idle',
    permission: null,
    userQuestion: null,
    planPhase: 'off',
    planApproval: null,
    planPreviewOpen: false,
    lastPlanContent: '',
    lastPlanHasBody: false,
    lastPlanToolCallId: '',
    subagents: [],
    chatTitle: '',
    composerInput: '',
    cwd: '',
    error: '',
    modelId: '',
    reasoningEffort: 'medium',
    utilityKind: null,
    backgroundTasks: {},
    sandboxCwd: '',
    sandboxOrigin: '',
    goal: null,
    workflows: {},
    terminals: {},
    queuedPrompts: [],
    totalTokens: 0,
    memoryFiles: [],
    scheduledTasks: [],
  }
}

/** 当前活跃 tab id（Phase 2 之前只有一个，现在可多开/切换） */
export const $activeTabId = atom('')

/**
 * Tab 活动灯：
 * - working 绿：仅「模型正在生成」或「子任务运行中」
 * - permission 黄：权限或 AI 问卷待确认
 * - error 红：异常
 * - idle 灰：含切换 Tab / 加载历史 / 重启会话（不闪绿）
 */
export type TabActivity = 'idle' | 'working' | 'permission' | 'error'

export function deriveTabActivity(s: TabState): TabActivity {
  if (s.phase === 'failed' || (s.error && s.error.trim().length > 0)) return 'error'
  if (s.permission || s.userQuestion || s.planApproval) return 'permission'
  const hasRunningSubagent = s.subagents.some((a) => a.status === 'running')
  // 不把 loading / restarting / initializing 算作 working，避免切会话、开历史时绿灯闪一下
  if (hasRunningSubagent || s.status === 'generating' || s.queuedPrompts.length > 0) {
    return 'working'
  }
  return 'idle'
}

/** TabBar 列表（id + 标题 + 失败标记 + 活动灯） */
export interface TabInfo {
  id: string
  title: string
  /** 连续 panic 超限，tab 处于 Failed 状态（TabBar 显示重试按钮） */
  failed?: boolean
  activity?: TabActivity
}
export const $tabs = atom<TabInfo[]>([])

/** 唯一事实源：tabId -> 会话状态 */
export const tabStates = new Map<string, TabState>()

export function hasTab(id: string): boolean {
  return tabStates.has(id)
}

/** 读某 tab 的当前状态（只读快照；不存在返回 undefined） */
export function getTabState(id: string): TabState | undefined {
  return tabStates.get(id)
}

/** 查找已打开的专用面板 Tab（技能 / 工具 / MCP / 自动化任务 / 流程画布 各只应有一个） */
export function findTabByUtilityKind(kind: UtilityKind): string | undefined {
  for (const [id, st] of tabStates) {
    if (st.utilityKind === kind) return id
  }
  return undefined
}

/** 是否像绝对路径（Windows 盘符 / UNC / Unix 根） */
export function looksAbsolutePath(p: string): boolean {
  const s = p.trim()
  if (!s) return false
  // UNC：\\server\share（源码字面量 '\\\\' = 2 个反斜杠）
  if (s.startsWith('/') || s.startsWith('\\')) return true
  // C:\… 或 C:/…
  return /^[a-zA-Z]:[\\/]/.test(s)
}

export function normPathKey(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 未绑定项目的闲聊工作区（~/.vesprism/scratch）。 */
export const $scratchCwd = atom('')

export function isScratchCwd(p: string, scratch = $scratchCwd.get()): boolean {
  const a = normPathKey(p)
  if (!a) return false
  const b = normPathKey(scratch)
  if (b && a === b) return true
  return a.endsWith('/.vesprism/scratch')
}

export function workspaceLabel(p: string): string {
  if (!p.trim()) return '闲聊'
  if (isScratchCwd(p)) return '闲聊'
  const key = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = key.split('/').filter(Boolean)
  return parts[parts.length - 1] || key || '闲聊'
}

/**
 * 解析当前应用应使用的工作区绝对路径。
 * 专用面板 Tab 可能未写入 cwd，切换后 $workspaceCwd 会变成空串，需从其它 tab / 选项兜底。
 */
export function resolveWorkspaceCwd(): string {
  const candidates: string[] = []
  const push = (v?: string | null) => {
    const s = (v ?? '').trim()
    if (s) candidates.push(s)
  }
  push($workspaceCwd.get())
  const active = $activeTabId.get()
  if (active) push(tabStates.get(active)?.cwd)
  for (const opt of $workspaceOptions.get()) push(opt)
  for (const st of tabStates.values()) push(st.cwd)
  for (const c of candidates) {
    if (looksAbsolutePath(c)) return c
  }
  const scratch = $scratchCwd.get().trim()
  if (looksAbsolutePath(scratch)) return scratch
  return candidates[0] || ''
}

/** 只认该 Tab 自己记下的 cwd，不借全局 config、也不借别的 Tab。 */
export function tabWorkspaceCwd(tabId?: string): string {
  const id = (tabId ?? $activeTabId.get()).trim()
  if (!id) return ''
  return (tabStates.get(id)?.cwd ?? '').trim()
}

/**
 * 新开会话 / 专用面板第一次落盘用的目录。
 * 当前 Tab → 用户主工作区 → 再兜底。避免画布去捡另一个对话的仓库。
 */
export function resolveNewTabCwd(): string {
  const own = tabWorkspaceCwd()
  if (looksAbsolutePath(own)) return own
  const preferred = $preferredWorkspaceCwd.get().trim()
  if (looksAbsolutePath(preferred)) return preferred
  return resolveWorkspaceCwd()
}

/**
 * 找普通对话 Tab：优先「空白新会话」（无 chatId、无消息），否则任意非 utility 的 Tab。
 * 侧栏 New chat 在专用面板里应切回这类 Tab，而不是把面板改成对话。
 */
export function findNormalChatTab(preferBlank = true): string | undefined {
  if (preferBlank) {
    for (const [id, st] of tabStates) {
      if (st.utilityKind) continue
      if (!st.chatId && st.messages.length === 0) return id
    }
  }
  for (const [id, st] of tabStates) {
    if (!st.utilityKind) return id
  }
  return undefined
}

/** 查找已打开该历史会话的 Tab（sessionId 或 chatId 匹配） */
export function findTabBySessionId(sessionId: string): string | undefined {
  const sid = sessionId.trim()
  if (!sid) return undefined
  for (const [id, st] of tabStates) {
    if (st.utilityKind) continue
    if (st.sessionId === sid || st.chatId === sid) return id
  }
  return undefined
}

/** 注册一个新 tab（openTab 成功后调用） */
export function createTab(id: string, initial: Partial<TabState> = {}): void {
  if (tabStates.has(id)) return
  const state = { ...emptyTabState(), ...initial }
  tabStates.set(id, state)
  $tabs.set([
    ...$tabs.get(),
    {
      id,
      title: initial.chatTitle ?? '',
      activity: deriveTabActivity(state),
      failed: state.phase === 'failed',
    },
  ])
}

/**
 * 新建 tab 时解析初始模型：优先继承指定 tab，否则用设置页默认，再退回当前投影。
 */
export function resolveNewTabModel(inheritFromTabId?: string): {
  modelId: string
  reasoningEffort: string
} {
  if (inheritFromTabId) {
    const s = tabStates.get(inheritFromTabId)
    if (s?.modelId) {
      return {
        modelId: s.modelId,
        reasoningEffort: s.reasoningEffort || 'medium',
      }
    }
  }
  const modelId =
    $settingsDefaultModelId.get() || $defaultModelId.get() || ''
  const entry = $models.get().find((m) => m.id === modelId)
  return {
    modelId,
    reasoningEffort:
      entry?.reasoning_effort || $reasoningEffort.get() || 'medium',
  }
}

/** 测试用：清空 tab map 与活跃投影（仅 vitest） */
export function resetTabsForTests(): void {
  tabStates.clear()
  $tabs.set([])
  $activeTabId.set('')
  $ptyAlive.set({})
  $ptyEpoch.set({})
  resetProjection()
}

/** 移除一个 tab（closeTab 成功后调用） */
export function removeTab(id: string): void {
  tabStates.delete(id)
  $tabs.set($tabs.get().filter((t) => t.id !== id))
  if ($activeTabId.get() === id) {
    $activeTabId.set('')
    // 清空投影，避免残留上一个 tab 的画面
    resetProjection()
  }
}

/** 投影增量字段到全局 atom（只 set patch 里出现的键） */
function projectPatch(patch: Partial<TabState>): void {
  if ('sessionId' in patch) $activeSessionId.set(patch.sessionId!)
  if ('chatId' in patch) $activeChatId.set(patch.chatId!)
  if ('messages' in patch) $messages.set(patch.messages!)
  if ('status' in patch) $engineStatus.set(patch.status!)
  if ('phase' in patch) $sessionPhase.set(patch.phase!)
  if ('permission' in patch) $permission.set(patch.permission!)
  if ('userQuestion' in patch) $userQuestion.set(patch.userQuestion!)
  if ('planPhase' in patch) $planPhase.set(patch.planPhase ?? 'off')
  if ('planApproval' in patch) $planApproval.set(patch.planApproval ?? null)
  if ('planPreviewOpen' in patch) $planPreviewOpen.set(Boolean(patch.planPreviewOpen))
  if ('lastPlanContent' in patch) $lastPlanContent.set(patch.lastPlanContent ?? '')
  if ('lastPlanHasBody' in patch) $lastPlanHasBody.set(Boolean(patch.lastPlanHasBody))
  if ('lastPlanToolCallId' in patch) $lastPlanToolCallId.set(patch.lastPlanToolCallId ?? '')
  if ('subagents' in patch) $subagents.set(patch.subagents!)
  if ('chatTitle' in patch) $chatTitle.set(patch.chatTitle!)
  if ('composerInput' in patch) $composerInput.set(patch.composerInput!)
  if ('cwd' in patch) $workspaceCwd.set(patch.cwd!)
  if ('error' in patch) $error.set(patch.error!)
  if ('modelId' in patch) $defaultModelId.set(patch.modelId!)
  if ('reasoningEffort' in patch) $reasoningEffort.set(patch.reasoningEffort!)
  if ('utilityKind' in patch) $utilityKind.set(patch.utilityKind ?? null)
  if ('backgroundTasks' in patch) $backgroundTasks.set(patch.backgroundTasks!)
  if ('sandboxCwd' in patch) $sandboxCwd.set(patch.sandboxCwd ?? '')
  if ('sandboxOrigin' in patch) $sandboxOrigin.set(patch.sandboxOrigin ?? '')
  if ('goal' in patch) $goalInfo.set(patch.goal ?? null)
  if ('workflows' in patch) $workflows.set(patch.workflows ?? {})
  if ('terminals' in patch) $terminals.set(patch.terminals ?? {})
  if ('queuedPrompts' in patch) $queuedPrompts.set(patch.queuedPrompts ?? [])
  if ('totalTokens' in patch) $totalTokens.set(patch.totalTokens ?? 0)
  if ('memoryFiles' in patch) $memoryFiles.set(patch.memoryFiles ?? [])
  if ('scheduledTasks' in patch) $scheduledTasks.set(patch.scheduledTasks ?? [])
}

/** 把 map[id] 全量投影到全局 atom（切换 tab 时用） */
function projectTab(id: string): void {
  const s = tabStates.get(id)
  if (!s) return
  projectPatch({
    sessionId: s.sessionId,
    chatId: s.chatId,
    messages: s.messages,
    status: s.status,
    phase: s.phase,
    permission: s.permission,
    userQuestion: s.userQuestion,
    planPhase: s.planPhase,
    planApproval: s.planApproval,
    planPreviewOpen: s.planPreviewOpen,
    lastPlanContent: s.lastPlanContent,
    lastPlanHasBody: s.lastPlanHasBody,
    lastPlanToolCallId: s.lastPlanToolCallId,
    subagents: s.subagents,
    chatTitle: s.chatTitle,
    composerInput: s.composerInput,
    cwd: s.cwd,
    error: s.error,
    modelId: s.modelId,
    reasoningEffort: s.reasoningEffort,
    utilityKind: s.utilityKind,
    backgroundTasks: s.backgroundTasks,
    sandboxCwd: s.sandboxCwd,
    sandboxOrigin: s.sandboxOrigin,
    goal: s.goal,
    workflows: s.workflows,
    terminals: s.terminals,
    queuedPrompts: s.queuedPrompts,
    totalTokens: s.totalTokens,
    memoryFiles: s.memoryFiles,
    scheduledTasks: s.scheduledTasks,
  })
}

/** 清空投影（关掉当前 tab 时用） */
function resetProjection(): void {
  projectPatch({
    sessionId: '',
    chatId: '',
    messages: [],
    status: 'unknown',
    phase: 'idle',
    permission: null,
    userQuestion: null,
    planPhase: 'off',
    planApproval: null,
    planPreviewOpen: false,
    lastPlanContent: '',
    lastPlanHasBody: false,
    lastPlanToolCallId: '',
    subagents: [],
    chatTitle: '',
    composerInput: '',
    cwd: '',
    error: '',
    modelId: '',
    reasoningEffort: 'medium',
    utilityKind: null,
    sandboxCwd: '',
    sandboxOrigin: '',
    goal: null,
    workflows: {},
    terminals: {},
    queuedPrompts: [],
    totalTokens: 0,
    memoryFiles: [],
    scheduledTasks: [],
  })
}

/**
 * 写 map[id] 并同步 $tabs 标题/活动灯；仅当 id 是当前活跃 tab 时投影到全局 atom。
 * 所有会话级状态变更（引擎事件、组件操作）都必须走这里。
 */
export function patchTab(id: string, patch: Partial<TabState>): void {
  const cur = tabStates.get(id)
  if (!cur) return
  const next = { ...cur, ...patch }
  tabStates.set(id, next)
  // 渲染预算：流式时每 chunk 都 patchTab（推进消息），但 tab 标题/活动灯未必变化。
  // 无条件 $tabs.set 会让 TabBar/Sidebar 等订阅者每帧重渲染；脏检查只在真正变化时通知。
  const activity = deriveTabActivity(next)
  const failed = next.phase === 'failed'
  const title = 'chatTitle' in patch ? (patch.chatTitle ?? '') : cur.chatTitle
  const list = $tabs.get()
  const current = list.find((t) => t.id === id)
  if (
    !current ||
    current.activity !== activity ||
    current.failed !== failed ||
    current.title !== title
  ) {
    $tabs.set(
      list.map((t) => (t.id === id ? { ...t, title, activity, failed } : t)),
    )
  }
  if (id === $activeTabId.get()) {
    projectPatch(patch)
  }
}

/** 当前活跃 tab 的快捷写入 */
export function patchActiveTab(patch: Partial<TabState>): void {
  const id = $activeTabId.get()
  if (!id) return
  patchTab(id, patch)
}

/** 空白 tab 是否可回收：无会话、无内容、无运行中任务、非专用面板 */
function isRecyclableBlank(st: TabState): boolean {
  if (st.utilityKind) return false
  if (st.chatId || st.sessionId) return false
  if (st.messages.length > 0) return false
  if (st.composerInput) return false
  if (st.status === 'generating') return false
  if (st.queuedPrompts.length > 0) return false
  if (st.phase === 'loading' || st.phase === 'restarting' || st.phase === 'booting') {
    return false
  }
  if (st.subagents.length > 0) return false
  if (st.permission || st.userQuestion || st.planApproval) return false
  return true
}

/**
 * 用户视角的空白「新对话」：无历史、无消息、非专用面板。
 * 引擎 sessionId 可已存在（bootstrap / startSession 之后仍显示「新对话」）。
 */
export function isBlankNewChat(st: TabState): boolean {
  if (st.utilityKind) return false
  if (st.chatId) return false
  if (st.messages.length > 0) return false
  if (st.composerInput.trim()) return false
  return true
}

/** 把已有 tab 原地清成空白新对话（保留模型；cwd 可覆盖） */
export function resetTabToNewChat(id: string, cwd?: string): void {
  const workCwd = (cwd ?? getTabState(id)?.cwd ?? '').trim()
  patchTab(id, {
    messages: [],
    composerInput: '',
    permission: null,
    userQuestion: null,
    planPhase: 'off',
    planApproval: null,
    planPreviewOpen: false,
    lastPlanContent: '',
    lastPlanHasBody: false,
    lastPlanToolCallId: '',
    subagents: [],
    backgroundTasks: {},
    error: '',
    chatId: '',
    sessionId: '',
    chatTitle: '',
    phase: 'restarting',
    status: 'initializing',
    utilityKind: null,
    queuedPrompts: [],
    totalTokens: 0,
    memoryFiles: [],
    scheduledTasks: [],
    ...(workCwd ? { cwd: workCwd } : {}),
  })
}

/** 切换活跃 tab：先切 id 再投影（事件在两者之间到达时按新 id 路由，投影幂等） */
export function switchTab(id: string): void {
  if (!tabStates.has(id)) return
  const prev = $activeTabId.get()
  if (prev === id) return
  $activeTabId.set(id)
  projectTab(id)
  // 切走时自动回收空白 tab（保留至少 1 个；生成中/加载中/有任务的一律不回收）
  // 注意：须在切完之后回收，否则 removeTab(prev) 会把 active 置空并清投影
  if (prev && prev !== id && tabStates.size > 1) {
    const prevState = tabStates.get(prev)
    if (prevState && isRecyclableBlank(prevState)) {
      removeTab(prev)
    }
  }
}

// ── Tab（Phase 1：先只支持单 tab，Phase 2 再扩展成 map） ──
// $activeTabId 已上移为分片核心；下方全部是「当前 tab 投影」，读点照旧。

// ── 会话（投影） ──
export const $activeSessionId = atom('')
export const $messages = atom<ChatMessage[]>([])
export const $queuedPrompts = atom<QueuedPrompt[]>([])
export const $totalTokens = atom(0)
export const $memoryFiles = atom<MemoryFileInfo[]>([])
export const $scheduledTasks = atom<ScheduledTaskInfo[]>([])
export const $sessionInsightOpen = atom(false)
/** 当前对话的定时任务卡（挂在本会话，不开新 Tab） */
export const $sessionScheduleOpen = atom(false)
export const $permission = atom<PermissionRequest | null>(null)
/** 内嵌审批条是否在视口内（Permission.tsx 的 IntersectionObserver 维护；浮层兜底读它） */
export const $permissionInlineVisible = atom(true)
export const $userQuestion = atom<UserQuestionRequest | null>(null)
export const $planPhase = atom<PlanPhase>('off')
export const $planApproval = atom<ExitPlanModeRequest | null>(null)
export const $planPreviewOpen = atom(false)
export const $lastPlanContent = atom('')
export const $lastPlanHasBody = atom(false)
export const $lastPlanToolCallId = atom('')
export const $subagents = atom<SubagentRuntime[]>([])
export const $error = atom('')
export const $engineStatus = atom<SessionStatus>('unknown')
export const $sessionPhase = atom<SessionPhase>('idle')

export const $generating = computed($engineStatus, (s) => s === 'generating')
export const $shellReady = computed($sessionPhase, (p) => p === 'ready')
/** 有运行中的子 agent 时亮活动指示 */
export const $hasRunningSubagents = computed($subagents, (list) =>
  list.some((s) => s.status === 'running'),
)

/** 合并/更新某 tab 的子 agent 条目，并同步对话内 scaffold 行 */
export function upsertSubagent(
  tabId: string,
  patch: Partial<SubagentRuntime> & { subagentId: string },
): void {
  const st = tabStates.get(tabId)
  if (!st) return
  const list = st.subagents.slice()
  const idx = list.findIndex((s) => s.subagentId === patch.subagentId)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch }
  } else {
    list.push({
      parentSessionId: '',
      childSessionId: '',
      subagentType: 'general-purpose',
      description: '',
      status: 'running',
      ...patch,
    })
  }
  // 上限 20 条：优先裁掉已结束的；全是运行中就裁最老的（按列表顺序）
  const MAX_SUBAGENTS = 20
  if (list.length > MAX_SUBAGENTS) {
    const ended = list.filter((x) => x.status !== 'running')
    const overflow = list.length - MAX_SUBAGENTS
    if (ended.length >= overflow) {
      let removed = 0
      for (let i = 0; i < list.length && removed < overflow; i++) {
        if (list[i].status !== 'running') {
          list.splice(i, 1)
          removed++
          i--
        }
      }
    } else {
      list.splice(0, overflow)
    }
  }
  const entry = list[idx >= 0 ? idx : list.length - 1]
  const messages = upsertSubagentMessage(st.messages, entry)
  patchTab(tabId, { subagents: list, messages })
}

// ── 模型 ──
/** 模型目录（全局共享，对齐官方 pager models catalog） */
export const $models = atom<ModelInfo[]>([])
/**
 * 设置页「默认模型」（config 级，跨 tab）。
 * 新建 tab / 冷启动首 tab 用它；不等于当前 tab 正在用的模型。
 */
export const $settingsDefaultModelId = atom('')
/**
 * 当前 tab 的模型 id / 推理强度（TabState 投影）。
 * 组件读点可继续用这两个 atom；写点必须 patchTab / patchActiveTab。
 */
export const $defaultModelId = atom('')
export const $reasoningEffort = atom('medium')

// ── 工作区（$workspaceCwd 是当前 tab 投影；历史列表全局） ──
export const $workspaceCwd = atom('')
export const $workspaceOptions = atom<string[]>([])
/** 用户钉住的仓库根（侧栏项目表）；与会话 cwd 分组互补，空仓库也能列出来。 */
export const $registeredProjects = atom<string[]>([])
/**
 * 用户「主工作区」（设置/Composer 显式切换）。
 * 侧栏分组置顶、默认展开用它——勿用当前 Tab 的 cwd，
 * 否则点其它工作区下的历史会话会把整组拖到最上面。
 */
export const $preferredWorkspaceCwd = atom('')

/** 当前生效的工具执行策略（全局或工作区覆盖） */
export const $securityPolicy = atom<SecurityPolicy>(DEFAULT_SECURITY_POLICY)
/** 本会话临时覆盖（/sandbox）；空则用 $securityPolicy */
export const $sessionPolicyOverride = atom<SecurityPolicy['executionPolicy'] | null>(null)
/** 当前活跃会话的隔离 worktree；空=未沙箱 */
export const $sandboxCwd = atom('')
export const $sandboxOrigin = atom('')

// ── UI ──
export const $sidebarCollapsed = atom(false)
export const $sidebarAutoCollapsed = atom(false)
export const $commandPaletteOpen = atom(false)
export const $settingsOpen = atom(false)

// ── 聊天列表（全局） ──
export interface ChatSummary {
  id: string
  title: string
  cwd: string
  updatedAt: string
}
export const $chats = atom<ChatSummary[]>([])

// ── 顶部标题 / 侧栏高亮 / 输入草稿（TabState 投影，读点照旧） ──
export const $activeChatId = atom('') // TabState.chatId 投影
export const $chatTitle = atom('') // TabState.chatTitle 投影
export const $composerInput = atom('') // TabState.composerInput 投影
/** 专用面板类型投影（mcp / skills / tools） */
export const $utilityKind = atom<UtilityKind | null>(null)

/** 最近一次官方 MCP 推送（面板用来改状态 / 刷新列表） */
export type McpPushEvent = {
  tabId: string
  method: string
  payload: Record<string, unknown>
  seq: number
}
export const $mcpPush = atom<McpPushEvent | null>(null)

// ── 右侧栏 ──
export type RightPanelTab = 'files' | 'output' | 'diff'
export const $rightPanelOpen = atom(false)
export const $rightPanelTab = atom<RightPanelTab>('files')
/** 工作区未提交改动数，供顶栏入口角标 */
export const $workspaceChangeCount = atom(0)
export const $rightPanelWidth = atom(320)
export const $rightPanelOutput = atom('')/** 源码视图当前显示的文件名（文件树打开时设置） */
export const $rightPanelFile = atom('')
/** 源码 / 差异绑定的绝对路径 */
export const $rightPanelFilePath = atom('')
/** git HEAD 变化版本号：官方 `git_head_changed` 事件时 +1，右栏差异据此自动刷新 */
export const $gitHeadRevision = atom(0)
export function bumpGitHeadRevision() {
  $gitHeadRevision.set($gitHeadRevision.get() + 1)
}

// ── Rewind（会话历史回滚）弹层 ──
/** Goal 编排进度（活跃 tab 投影） */
export const $goalInfo = atom<GoalInfoDto | null>(null)
/** 工作流运行进度（活跃 tab 投影；key=runId） */
export const $workflows = atom<Record<string, WorkflowInfoDto>>({})
const RECENT_WORKFLOWS_KEY = 'vesprism.recent_workflows.v1'

function loadInitialRecentWorkflows(): Record<string, WorkflowInfoDto> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(RECENT_WORKFLOWS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, WorkflowInfoDto>
    }
  } catch (e) {
    console.warn('[store] 读取试跑历史失败:', e)
  }
  return {}
}

function persistRecentWorkflows(val: Record<string, WorkflowInfoDto>): void {
  try {
    if (typeof localStorage === 'undefined') return
    // 保留最近 50 条试跑记录，避免数据无限膨胀
    const entries = Object.entries(val)
    const trimmed = entries.length > 50 ? Object.fromEntries(entries.slice(-50)) : val
    localStorage.setItem(RECENT_WORKFLOWS_KEY, JSON.stringify(trimmed))
  } catch (e) {
    console.warn('[store] 持久化试跑历史失败:', e)
  }
}

/** 试跑详情面板：全局最近 workflow 运行（跨 tab 合并，key=runId，新覆盖旧，自动落盘持久化）。 */
export const $recentWorkflows = atom<Record<string, WorkflowInfoDto>>(loadInitialRecentWorkflows())

export function upsertRecentWorkflow(w: WorkflowInfoDto): void {
  if (!w?.runId) return
  const next = { ...$recentWorkflows.get(), [w.runId]: w }
  $recentWorkflows.set(next)
  persistRecentWorkflows(next)
}

export function clearRecentWorkflows(): void {
  $recentWorkflows.set({})
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(RECENT_WORKFLOWS_KEY)
    }
  } catch {}
}
/** 客户端终端运行态（活跃 tab 投影；key=terminalId） */
export const $terminals = atom<Record<string, TerminalRuntime>>({})
/** 会话区内嵌侧栏：同一时间只开一块。 */
export type SessionDockKind = 'subagents' | 'terminal' | 'bgTasks'
export const $sessionDockKind = atom<SessionDockKind | null>(null)
export const $sessionDockWidth = atom(320)
export function toggleSessionDock(kind: SessionDockKind): void {
  $sessionDockKind.set($sessionDockKind.get() === kind ? null : kind)
}

/** 该 Tab 的交互式 PTY 是否还活着（切 Tab 不杀，仅 UI detach） */
export const $ptyAlive = atom<Record<string, boolean>>({})
export function markPtyAlive(tabId: string, alive: boolean): void {
  if (!tabId) return
  const prev = $ptyAlive.get()
  if (!alive) {
    if (!(tabId in prev)) return
    const next = { ...prev }
    delete next[tabId]
    $ptyAlive.set(next)
    return
  }
  if (prev[tabId]) return
  $ptyAlive.set({ ...prev, [tabId]: true })
}

/** 关 Tab / 杀进程后 +1，逼 TerminalPane 重挂（同一 tabId+cwd 也会换新壳） */
export const $ptyEpoch = atom<Record<string, number>>({})
export function bumpPtyEpoch(tabId: string): void {
  if (!tabId) return
  const prev = $ptyEpoch.get()
  $ptyEpoch.set({ ...prev, [tabId]: (prev[tabId] ?? 0) + 1 })
}
/** 组装单面板开关 */
export const $compositionOpen = atom(false)
/** 子代理目录弹出层开关（会话 header 按钮） */
export const $subagentCatalogOpen = atom(false)

// ── 运行中子代理聚合（侧栏徽标；DSH workspace rows 语义）──

/** parentSessionId → 运行中子代理数（跨 tab 聚合，仅供徽标展示） */
export const $runningByParent = atom<Record<string, number>>({})

/** 已计入的子代理 id → 父会话 id（spawn/finished 事件与启动对账共用，避免重复计数） */
const trackedRunningSubagents = new Map<string, string>()

/** 标记一个子代理开始运行（幂等）；返回是否首次计入。 */
export function trackSubagentRunning(subagentId: string, parentSessionId: string): boolean {
  if (!subagentId || !parentSessionId) return false
  if (trackedRunningSubagents.has(subagentId)) return false
  trackedRunningSubagents.set(subagentId, parentSessionId)
  const map = $runningByParent.get()
  $runningByParent.set({ ...map, [parentSessionId]: (map[parentSessionId] ?? 0) + 1 })
  return true
}

/**
 * 标记一个子代理结束运行（幂等）；返回是否实际移除了计数。
 * `parentFallback`：finished 事件不带父会话 id，用 tab 内已存条目兜底。
 */
export function untrackSubagentRunning(
  subagentId: string,
  parentFallback: string,
): boolean {
  if (!subagentId) return false
  const parent = trackedRunningSubagents.get(subagentId) ?? parentFallback
  if (!trackedRunningSubagents.delete(subagentId)) return false
  const map = $runningByParent.get()
  const cur = map[parent] ?? 0
  const next = Math.max(0, cur - 1)
  $runningByParent.set({ ...map, [parent]: next })
  return true
}

export const $rewindOpen = atom(false)
export const $rewindTabId = atom('')
export function openRewind(tabId: string) {
  $rewindTabId.set(tabId)
  $rewindOpen.set(true)
}
export function closeRewind() {
  $rewindOpen.set(false)
}

// ── bash 后台任务（task_backgrounded）──
export const $backgroundTasks = atom<Record<string, BackgroundTaskInfo>>({})
/** 登记后台任务（事件到达时） */
export function setBackgroundTask(
  tabId: string,
  toolCallId: string,
  info: BackgroundTaskInfo
): void {
  const st = getTabState(tabId)
  if (!st) return
  patchTab(tabId, {
    backgroundTasks: { ...st.backgroundTasks, [toolCallId]: info },
  })
}
/** 移除后台任务（kill 成功 / 工具结束） */
export function removeBackgroundTask(tabId: string, toolCallId: string): void {
  const st = getTabState(tabId)
  if (!st) return
  const next = { ...st.backgroundTasks }
  delete next[toolCallId]
  patchTab(tabId, { backgroundTasks: next })
}

// ── Toast（顶部浮层，不进对话历史；如切换模型） ──
export type ToastTone = 'info' | 'success' | 'error'
export type ToastItem = {
  id: string
  message: string
  tone?: ToastTone
}
export const $toasts = atom<ToastItem[]>([])

export function pushToast(message: string, tone: ToastTone = 'info') {
  const id = `toast_${crypto.randomUUID()}`
  const prev = $toasts.get()
  $toasts.set([...prev.slice(-4), { id, message, tone }])
}

export function dismissToast(id: string) {
  $toasts.set($toasts.get().filter((t) => t.id !== id))
}

// ── 操作（作用于当前 tab，走 patchActiveTab） ──
export function addMessage(msg: ChatMessage) {
  patchActiveTab({ messages: [...$messages.get(), msg] })
}

export function appendToLastMessage(text: string, role: ChatMessage['role'] = 'assistant') {
  const msgs = $messages.get()
  const last = msgs[msgs.length - 1]
  if (last && last.role === role) {
    patchActiveTab({ messages: [...msgs.slice(0, -1), { ...last, text: last.text + text }] })
  } else {
    addMessage({ id: crypto.randomUUID(), role, text })
  }
}
