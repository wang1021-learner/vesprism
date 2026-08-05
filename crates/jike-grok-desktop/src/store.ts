/**
 * nanostores 状态 — 对齐原始 jike-grok-desktop
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
  UserQuestionRequest,
} from './types'

// ── Tab 分片 ──────────────────────────────────────────────────────────

/** 单个 tab 的会话状态（字段语义对齐官方 RosterEntry：sessionId/title/cwd/modelId/activity） */
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
}

export function emptyTabState(): TabState {
  return {
    sessionId: '',
    chatId: '',
    messages: [],
    status: 'unknown',
    phase: 'idle',
    permission: null,
    userQuestion: null,
    subagents: [],
    chatTitle: '',
    composerInput: '',
    cwd: '',
    error: '',
    modelId: '',
    reasoningEffort: 'medium',
  }
}

/** 当前活跃 tab id（Phase 2 之前只有一个，现在可多开/切换） */
export const $activeTabId = atom('')

/**
 * Tab 活动灯：
 * - working 绿：生成 / 加载 / 子任务运行
 * - permission 黄：权限或 AI 问卷待确认
 * - error 红：异常
 * - idle 灰
 */
export type TabActivity = 'idle' | 'working' | 'permission' | 'error'

export function deriveTabActivity(s: TabState): TabActivity {
  if (s.phase === 'failed' || (s.error && s.error.trim().length > 0)) return 'error'
  if (s.permission || s.userQuestion) return 'permission'
  const hasRunningSubagent = s.subagents.some((a) => a.status === 'running')
  if (
    hasRunningSubagent ||
    s.status === 'generating' ||
    s.status === 'initializing' ||
    s.phase === 'loading' ||
    s.phase === 'restarting' ||
    s.phase === 'booting'
  ) {
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
const tabStates = new Map<string, TabState>()

export function hasTab(id: string): boolean {
  return tabStates.has(id)
}

/** 读某 tab 的当前状态（只读快照；不存在返回 undefined） */
export function getTabState(id: string): TabState | undefined {
  return tabStates.get(id)
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
 * 新建 tab 时解析初始模型：优先继承指定 tab，否则用设置页默认。
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
  const modelId = $defaultModelId.get() || ''
  const entry = $models.get().find((m) => m.id === modelId)
  return {
    modelId,
    reasoningEffort:
      entry?.reasoning_effort || $reasoningEffort.get() || 'medium',
  }
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
  if ('subagents' in patch) $subagents.set(patch.subagents!)
  if ('chatTitle' in patch) $chatTitle.set(patch.chatTitle!)
  if ('composerInput' in patch) $composerInput.set(patch.composerInput!)
  if ('cwd' in patch) $workspaceCwd.set(patch.cwd!)
  if ('error' in patch) $error.set(patch.error!)
  if ('modelId' in patch) $defaultModelId.set(patch.modelId!)
  if ('reasoningEffort' in patch) $reasoningEffort.set(patch.reasoningEffort!)
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
    subagents: s.subagents,
    chatTitle: s.chatTitle,
    composerInput: s.composerInput,
    cwd: s.cwd,
    error: s.error,
    modelId: s.modelId,
    reasoningEffort: s.reasoningEffort,
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
    subagents: [],
    chatTitle: '',
    composerInput: '',
    cwd: '',
    error: '',
    modelId: '',
    reasoningEffort: 'medium',
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
  const activity = deriveTabActivity(next)
  const failed = next.phase === 'failed'
  $tabs.set(
    $tabs.get().map((t) =>
      t.id === id
        ? {
            ...t,
            title: 'chatTitle' in patch && patch.chatTitle ? patch.chatTitle! : t.title,
            activity,
            failed,
          }
        : t,
    ),
  )
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

/** 切换活跃 tab：先切 id 再投影（事件在两者之间到达时按新 id 路由，投影幂等） */
export function switchTab(id: string): void {
  if (!tabStates.has(id)) return
  $activeTabId.set(id)
  projectTab(id)
}

// ── Tab（Phase 1：先只支持单 tab，Phase 2 再扩展成 map） ──
// $activeTabId 已上移为分片核心；下方全部是「当前 tab 投影」，读点照旧。

// ── 会话（投影） ──
export const $activeSessionId = atom('')
export const $messages = atom<ChatMessage[]>([])
export const $permission = atom<PermissionRequest | null>(null)
export const $userQuestion = atom<UserQuestionRequest | null>(null)
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

/** 合并/更新某 tab 的子 agent 条目 */
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
  patchTab(tabId, { subagents: list })
}

// ── 模型（全局设置，跨 tab 共享 — 对齐官方 pager `models: ModelState shared across agents`） ──
export const $models = atom<ModelInfo[]>([])
export const $defaultModelId = atom('')
export const $reasoningEffort = atom('medium')

// ── 工作区（$workspaceCwd 是当前 tab 投影；历史列表全局） ──
export const $workspaceCwd = atom('')
export const $workspaceOptions = atom<string[]>([])

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

// ── 右侧栏 ──
export type RightPanelTab = 'files' | 'output'
export const $rightPanelOpen = atom(false)
export const $rightPanelTab = atom<RightPanelTab>('files')
export const $rightPanelWidth = atom(320)
export const $rightPanelOutput = atom('')
/** 源码视图当前显示的文件名（文件树打开时设置） */
export const $rightPanelFile = atom('')

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
