/**
 * 侧栏 — 对齐重构前样式与逻辑：
 * 品牌顶栏 · New chat 胶囊 · 工作区折叠分组 · 会话 ⋮ 菜单（重命名/删除）· 底部设置
 */
import { useStore } from '@nanostores/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  $activeTabId,
  $chats,
  $defaultModelId,
  $engineStatus,
  $models,
  $reasoningEffort,
  $settingsOpen,
  $sidebarAutoCollapsed,
  $sidebarCollapsed,
  $commandPaletteOpen,
  createTab,
  findNormalChatTab,
  findTabBySessionId,
  getTabState,
  looksAbsolutePath,
  patchActiveTab,
  patchTab,
  removeTab,
  resolveNewTabModel,
  resolveWorkspaceCwd,
  switchTab,
  $workspaceCwd,
  $preferredWorkspaceCwd,
  type ChatSummary,
} from '../store'
import { clearSessionAllowed } from '../lib/permissionMemory'
import { tabStates, pushToast } from '../store'
import {
  closeTab,
  deleteSession,
  getSessionMessages,
  listSessions,
  loadSession,
  openTab,
  renameSession,
  restartSession,
  searchSessions,
  setCurrentModel,
  startSession,
} from '../bridge'
import {
  abortOpenSession,
  beginAttachRuntime,
  cacheSessionMessages,
  currentLoadGen,
  finishAttachRuntime,
  getCachedSessionMessages,
  hydrateFromSnapshot,
  invalidateSessionMessages,
  nextLoadGen,
} from '../lib/sessionOpen'
import type { ChatMessage, ToolCallData } from '../types'
import { openChatTab } from '../lib/openChatTab'
import { reconcileRunningSubagents } from '../lib/reconcileRunningSubagents'
import { BrandLogo, BrandWordmark } from './BrandLogo'

/** FTS 搜索结果行（可带 snippet） */
type SearchHit = ChatSummary & { snippet?: string }

/** 磁盘投影 → ChatMessage（工具字段与实时 ToolCallInfo 对齐，不再靠标题猜 kind） */
function hydrateDisplayMessage(m: {
  id: string
  role: string
  text: string
  tool?: string | null
  tool_call_id?: string | null
  prompt_id?: string | null
  kind?: string | null
  status?: string | null
  detail?: string | null
  preview?: string | null
  start_ms?: number | null
  end_ms?: number | null
}): ChatMessage {
  const role = (
    ['user', 'assistant', 'system', 'thought', 'tool'].includes(m.role)
      ? m.role
      : 'assistant'
  ) as ChatMessage['role']

  if (role === 'tool') {
    const title = m.tool || 'tool'
    const preview = m.preview || m.text || ''
    const detail = m.detail || title
    const toolCall: ToolCallData = {
      toolCallId: m.tool_call_id || m.id,
      kind: (m.kind || 'other').toLowerCase(),
      status: (m.status || 'completed').toLowerCase(),
      title,
      detail,
      preview,
      // 历史耗时：磁盘 updates.jsonl 的 timestamp 解析（毫秒）
      timing:
        m.start_ms != null
          ? { start: m.start_ms, ...(m.end_ms != null ? { end: m.end_ms } : {}) }
          : undefined,
    }
    return {
      id: m.id,
      role: 'tool',
      text: preview || detail,
      tool: title,
      toolCallId: toolCall.toolCallId,
      toolCall,
    }
  }

  return {
    id: m.id,
    role,
    text: m.text || '',
    ...(m.tool ? { tool: m.tool } : {}),
    ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
    ...(m.prompt_id ? { promptId: m.prompt_id } : {}),
  }
}

/** 简洁文件夹线框（不用 emoji / 系统桌面图标） */
function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className={`sidebar-folder-icon${open ? ' open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l1.8 1.8c.2.2.5.3.8.3H19.5A1.5 1.5 0 0 1 21 9.6v8.9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {open ? (
        <path
          d="M3 11h18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          opacity="0.55"
        />
      ) : null}
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

/** 技能 — 书签/文档 */
function SkillIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <path
        d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 工具 — 扳手 */
function ToolIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** MCP — 插头/连接 */
function McpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <path
        d="M12 2v6M8 4v4M16 4v4"
        strokeLinecap="round"
      />
      <path
        d="M7 10h10v3a5 5 0 0 1-5 5h0a5 5 0 0 1-5-5v-3Z"
        strokeLinejoin="round"
      />
      <path d="M12 18v4" strokeLinecap="round" />
    </svg>
  )
}

/** 自动化任务 — 流程/循环 */
function WorkflowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <path d="M4 6h6v4H4zM14 6h6v4h-6zM9 14h6v4H9z" strokeLinejoin="round" />
      <path d="M7 10v2h10v-2M12 10v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 搜索结果右侧相对时间 */
function formatSearchTimeLabel(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function CollapsibleWorkspaceBody({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  if (!open) return null
  return <div className="sidebar-workspace-body">{children}</div>
}

function normalizeCwdKey(cwd: string | undefined): string {
  return (cwd || '').trim().replace(/\\/g, '/').replace(/\/+$/, '') || '(未知工作空间)'
}

function workspaceDisplayName(cwd: string): string {
  const key = normalizeCwdKey(cwd)
  if (key === '(未知工作空间)') return key
  const parts = key.split('/').filter(Boolean)
  return parts[parts.length - 1] || key
}

type WorkspaceGroup = {
  cwdKey: string
  label: string
  fullPath: string
  isCurrent: boolean
  /** 仅按工作区分组；组内按更新时间降序 */
  chats: ChatSummary[]
}

interface Props {
  collapsed: boolean
  activeChatId: string
}

export function Sidebar({ collapsed, activeChatId }: Props) {

/** New Chat 软上限：超过提示不硬拦 */
const MAX_TABS = 12
  const chats = useStore($chats)
  const cwd = useStore($workspaceCwd)
  /** 主工作区：侧栏置顶/默认展开；勿用当前 Tab cwd（点历史会误把整组拖到最上面） */
  const preferredCwd = useStore($preferredWorkspaceCwd)

  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
  const [menuOpenChatId, setMenuOpenChatId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  /** 官方 FTS 结果；空 query 时不用 */
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchBootstrapping, setSearchBootstrapping] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [renameChat, setRenameChat] = useState<ChatSummary | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ChatSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchGenRef = useRef(0)

  const refreshChats = useCallback(async (workspace?: string) => {
    // 用主工作区做「当前优先」排序参数；列表本身含全部 cwd 的会话
    const w =
      workspace ||
      $preferredWorkspaceCwd.get() ||
      $workspaceCwd.get()
    if (!w) return
    try {
      const list = await listSessions(w, 300)
      $chats.set(
        list.map((c) => ({
          id: c.id,
          title: c.title || '新对话',
          cwd: c.cwd,
          updatedAt: c.updated_at,
        })),
      )
    } catch (e) {
      console.warn('刷新会话列表失败', e)
    }
  }, [])

  // 仅主工作区变化时刷新列表；切 Tab / 打开其它 cwd 历史不重排侧栏
  useEffect(() => {
    if (!preferredCwd) return
    void refreshChats(preferredCwd)
  }, [preferredCwd, refreshChats])

  useEffect(() => {
    if (!menuOpenChatId) return
    const onDown = () => setMenuOpenChatId(null)
    window.addEventListener('click', onDown)
    return () => window.removeEventListener('click', onDown)
  }, [menuOpenChatId])

  const openSearch = () => {
    $commandPaletteOpen.set(true)
    setMenuOpenChatId(null)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchHits([])
    setSearchError('')
    setSearchLoading(false)
    setSearchBootstrapping(false)
  }

  // 搜索弹层：Esc 关闭；打开时聚焦
  useEffect(() => {
    if (!searchOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch()
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [searchOpen])

  // 官方 FTS（debounce 250ms）
  useEffect(() => {
    const q = searchQuery.trim()
    if (!searchOpen || !q) {
      setSearchHits([])
      setSearchLoading(false)
      setSearchBootstrapping(false)
      setSearchError('')
      return
    }
    const gen = ++searchGenRef.current
    setSearchLoading(true)
    setSearchError('')
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await searchSessions(q, null, 50)
          if (gen !== searchGenRef.current) return
          setSearchBootstrapping(Boolean(res.bootstrapping))
          setSearchHits(
            res.results.map((r) => ({
              id: r.id,
              title: r.title || '新对话',
              cwd: r.cwd,
              updatedAt: r.updated_at,
              snippet: r.snippet || undefined,
            })),
          )
        } catch (e) {
          if (gen !== searchGenRef.current) return
          setSearchHits([])
          setSearchError(String(e))
        } finally {
          if (gen === searchGenRef.current) setSearchLoading(false)
        }
      })()
    }, 250)
    return () => window.clearTimeout(t)
  }, [searchQuery, searchOpen])

  const workspaceGroups = useMemo((): WorkspaceGroup[] => {
    // 置顶 = 主工作区（设置/Composer 切换），不是当前 Tab 打开的历史会话 cwd
    const pinKey = normalizeCwdKey(preferredCwd || cwd)
    const byWs = new Map<string, ChatSummary[]>()
    for (const c of chats) {
      const key = normalizeCwdKey(c.cwd)
      if (!byWs.has(key)) byWs.set(key, [])
      byWs.get(key)!.push(c)
    }
    const groups: WorkspaceGroup[] = []
    for (const [key, list] of byWs) {
      const sorted = [...list].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      groups.push({
        cwdKey: key,
        label: workspaceDisplayName(key),
        fullPath: key,
        isCurrent: Boolean(pinKey) && key === pinKey,
        chats: sorted,
      })
    }
    groups.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return a.label.localeCompare(b.label, 'zh')
    })
    return groups
  }, [chats, preferredCwd, cwd])

  const toggleWorkspace = (ws: WorkspaceGroup) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      const collapsed = isWorkspaceCollapsed(ws)
      if (collapsed) {
        // 展开：去掉折叠标记，记下 open
        next.delete(ws.cwdKey)
        next.add(`open:${ws.cwdKey}`)
      } else {
        next.delete(`open:${ws.cwdKey}`)
        next.add(ws.cwdKey)
      }
      return next
    })
  }

  /** 默认：当前工作区展开；集合内 = 折叠 */
  const isWorkspaceCollapsed = (ws: WorkspaceGroup) => {
    if (collapsedWorkspaces.has(ws.cwdKey)) return true
    if (collapsedWorkspaces.has(`open:${ws.cwdKey}`)) return false
    return !ws.isCurrent
  }

  /**
   * 打开历史会话：
   * 1. 已在某 Tab 打开 → 立刻切换（不重载、不闪 loading）
   * 2. 否则后台新开/复用空白 Tab 加载；消息秒开后再切过去，避免输入框长时间「正在加载会话」
   */
  const onSelectChat = useCallback(async (id: string, sessionCwd?: string) => {
    setMenuOpenChatId(null)

    // 已打开：直接切换（phase 保持该 Tab 原状态，ready 则无绿闪）
    const existing = findTabBySessionId(id)
    if (existing) {
      switchTab(existing)
      return
    }

    const title =
      $chats.get().find((c) => c.id === id)?.title?.trim() || '历史会话'
    const workCwd = (sessionCwd || resolveWorkspaceCwd() || cwd).trim()
    if (!workCwd || !looksAbsolutePath(workCwd)) {
      patchActiveTab({
        error: '工作区路径无效，无法打开历史会话。请在设置中选择绝对路径工作区。',
      })
      return
    }

    const activeId = $activeTabId.get()
    const active = activeId ? getTabState(activeId) : undefined
    const reuseBlank =
      activeId &&
      active &&
      !active.utilityKind &&
      !active.chatId &&
      !active.sessionId &&
      active.messages.length === 0 &&
      active.phase !== 'loading'

    let myTab = activeId
    let createdNew = false
    // 新 Tab：先创建不切换，等有消息再 switch，用户可继续在当前 Tab 操作
    if (!reuseBlank) {
      try {
        const prevId = activeId
        myTab = await openTab()
        const model = resolveNewTabModel(prevId || undefined)
        createTab(myTab, {
          cwd: workCwd,
          chatTitle: title,
          chatId: id,
          modelId: model.modelId,
          reasoningEffort: model.reasoningEffort,
          utilityKind: null,
          phase: 'loading',
          status: 'initializing',
        })
        createdNew = true
      } catch (e) {
        patchActiveTab({ error: `打开会话 Tab 失败: ${String(e)}` })
        return
      }
    } else {
      myTab = activeId
      if (active?.sessionId) {
        const cur = getTabState(myTab)?.messages ?? []
        if (cur.length > 0) cacheSessionMessages(active.sessionId, cur)
      }
    }

    const gen = nextLoadGen(myTab)
    try {
      patchTab(myTab, {
        messages: [],
        phase: 'loading',
        status: 'initializing',
        error: '',
        chatId: id,
        chatTitle: title,
        cwd: workCwd,
        utilityKind: null,
        // 子 agent 状态随会话走；切历史必须清，避免状态灯/map 与消息流脱节
        subagents: [],
        permission: null,
        userQuestion: null,
      })
      // 本次会话权限记忆按会话清，避免命令记忆跨会话串用
      clearSessionAllowed(myTab)

      let messages = getCachedSessionMessages(id)
      if (!messages) {
        const raw = await getSessionMessages(id)
        if (gen !== currentLoadGen(myTab)) return
        messages = raw.map((m) => hydrateDisplayMessage(m))
        cacheSessionMessages(id, messages)
      } else if (gen !== currentLoadGen(myTab)) {
        return
      }

      // 消息先写入；新 Tab 在此再切换，用户看到的是内容而不是空白 loading
      hydrateFromSnapshot(messages, myTab)
      if (createdNew || reuseBlank) {
        switchTab(myTab)
      }

      beginAttachRuntime(myTab)
      await loadSession(myTab, id, workCwd)
      // 启动对账：恢复该会话仍在运行的子 agent（重启/重连场景，官方 x.ai/subagent/list_running）
      void reconcileRunningSubagents(myTab)
      if (gen !== currentLoadGen(myTab)) return
      finishAttachRuntime(myTab)
      // chatId 固定为侧栏历史 id，便于再次点击时命中已开 Tab
      patchTab(myTab, {
        sessionId: id,
        chatId: id,
        phase: 'ready',
        status: 'idle',
        error: '',
      })
      cacheSessionMessages(id, getTabState(myTab)?.messages ?? [])
    } catch (e) {
      if (gen !== currentLoadGen(myTab)) return
      abortOpenSession(myTab)
      const err = String(e)
      if (createdNew && myTab) {
        try {
          await closeTab(myTab)
        } catch {
          /* 后端可能未登记 */
        }
        removeTab(myTab)
        const fallback = findNormalChatTab(false) || $activeTabId.get()
        if (fallback && getTabState(fallback)) {
          switchTab(fallback)
          patchTab(fallback, { error: `打开历史会话失败: ${err}` })
        }
      } else {
        patchTab(myTab, { phase: 'ready', status: 'idle', error: err })
      }
    }
  }, [cwd])

  const handlePickSearchResult = (chat: SearchHit) => {
    closeSearch()
    void onSelectChat(chat.id, chat.cwd)
  }

  const onNewChat = useCallback(async () => {
    setMenuOpenChatId(null)

    const workCwd = resolveWorkspaceCwd()
    if (!workCwd || !looksAbsolutePath(workCwd)) {
      patchActiveTab({
        error:
          '工作区路径无效（Path is not absolute）。请先在设置中选择绝对路径工作区，再新建对话。',
      })
      return
    }

    // 软上限：超过提示但不硬拦（空白 tab 切走会自动回收）
    if (tabStates.size >= MAX_TABS) {
      pushToast(`已有 ${MAX_TABS} 个标签页，建议先关闭不用的`, 'info')
    }

    const activeId = $activeTabId.get()
    const activeState = activeId ? getTabState(activeId) : undefined

    // 当前 Tab 在加载历史 / 生成中 / 专用面板：新开空白对话 Tab，不阻塞、不冲掉当前页
    const shouldOpenFreshTab =
      !activeId ||
      !activeState ||
      Boolean(activeState.utilityKind) ||
      activeState.phase === 'loading' ||
      activeState.phase === 'restarting' ||
      activeState.phase === 'booting' ||
      activeState.status === 'generating' ||
      Boolean(activeState.chatId || activeState.sessionId) ||
      activeState.messages.length > 0

    if (shouldOpenFreshTab) {
      // 优先复用已有空白普通对话
      const blank = findNormalChatTab(true)
      if (
        blank &&
        blank !== activeId &&
        getTabState(blank) &&
        !getTabState(blank)?.chatId &&
        (getTabState(blank)?.messages.length ?? 0) === 0
      ) {
        switchTab(blank)
        await refreshChats()
        return
      }
      const opened = await openChatTab({ title: '' })
      if (opened) await refreshChats()
      return
    }

    // 当前已是空白普通对话：原地 restart 即可
    const tabId = activeId
    if ($engineStatus.get() === 'generating') return
    try {
      abortOpenSession(tabId)
      patchTab(tabId, {
        messages: [],
        composerInput: '',
        permission: null,
        userQuestion: null,
        subagents: [],
        error: '',
        chatId: '',
        sessionId: '',
        chatTitle: '',
        phase: 'restarting',
        status: 'initializing',
        utilityKind: null,
        cwd: workCwd,
      })

      try {
        await restartSession(tabId, workCwd)
      } catch {
        await startSession(tabId, workCwd)
      }

      const modelId = $defaultModelId.get().trim()
      if (modelId) {
        const entry = $models.get().find((m) => m.id === modelId)
        const effort = entry?.supports_reasoning_effort
          ? entry.reasoning_effort || $reasoningEffort.get() || 'medium'
          : undefined
        try {
          await setCurrentModel(tabId, modelId, effort)
          if (effort) $reasoningEffort.set(effort)
        } catch (e) {
          console.warn('新会话同步模型失败', e)
        }
      }

      patchTab(tabId, { phase: 'ready', status: 'idle', error: '' })
      await refreshChats()
    } catch (e) {
      patchTab(tabId, { phase: 'ready', status: 'idle', error: String(e) })
    }
  }, [refreshChats])

  // App 快捷键 Ctrl/Cmd+N
  useEffect(() => {
    const onNew = () => {
      void onNewChat()
    }
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; cwd?: string }>).detail
      if (detail?.id) {
        void onSelectChat(detail.id, detail.cwd)
      }
    }
    window.addEventListener('jike:new-chat', onNew)
    window.addEventListener('jike:open-chat', onOpen)
    return () => {
      window.removeEventListener('jike:new-chat', onNew)
      window.removeEventListener('jike:open-chat', onOpen)
    }
  }, [onNewChat, onSelectChat])

  const handleDelete = async (chat: ChatSummary) => {
    setBusy(true)
    try {
      await deleteSession($activeTabId.get(), chat.id, chat.cwd || cwd)
      invalidateSessionMessages(chat.id)
      if (chat.id === activeChatId) {
        patchActiveTab({ messages: [], chatId: '' })
        try {
          await restartSession($activeTabId.get(), cwd)
        } catch {
          await startSession($activeTabId.get(), cwd)
        }
      }
      setConfirmDelete(null)
      await refreshChats()
    } catch (e) {
      patchActiveTab({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const handleRename = async () => {
    if (!renameChat) return
    const title = renameInput.trim()
    if (!title) {
      setRenameError('标题不能为空')
      return
    }
    setBusy(true)
    setRenameError(null)
    try {
      await renameSession(renameChat.id, renameChat.cwd || cwd, title)
      setRenameChat(null)
      await refreshChats()
    } catch (e) {
      setRenameError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const [peekState, setPeekState] = useState<'closed' | 'peeking' | 'leaving'>('closed')
  const peekTimerRef = useRef<number | null>(null)

  const clearPeekTimer = () => {
    if (peekTimerRef.current !== null) {
      window.clearTimeout(peekTimerRef.current)
      peekTimerRef.current = null
    }
  }

  const handleMouseEnter = () => {
    if (!collapsed) return
    clearPeekTimer()
    if (peekState === 'leaving') {
      setPeekState('peeking')
      return
    }
    peekTimerRef.current = window.setTimeout(() => {
      setPeekState('peeking')
    }, 180)
  }

  const handleMouseLeave = () => {
    clearPeekTimer()
    peekTimerRef.current = window.setTimeout(() => {
      setPeekState('leaving')
      peekTimerRef.current = window.setTimeout(() => {
        setPeekState('closed')
      }, 170)
    }, 200)
  }

  const onToggleCollapse = () => {
    $sidebarCollapsed.set(!$sidebarCollapsed.get())
    $sidebarAutoCollapsed.set(false)
    setPeekState('closed')
  }

  const onOpenSettings = () => {
    $settingsOpen.set(true)
  }

  /** 侧栏「技能 / 工具 / MCP / 自动化任务」：各开一个带标题的专用 Tab */
  const onOpenUtilityTab = useCallback(
    async (kind: 'skills' | 'tools' | 'mcp' | 'workflows') => {
      const title =
        kind === 'skills'
          ? '技能'
          : kind === 'tools'
            ? '工具'
            : kind === 'mcp'
              ? 'MCP'
              : '自动化任务'
      setMenuOpenChatId(null)
      await openChatTab({ title, utilityKind: kind })
    },
    [],
  )

  const isPeekingOrLeaving = collapsed && (peekState === 'peeking' || peekState === 'leaving')

  if (collapsed) {
    return (
      <>
        <aside
          className="sidebar sidebar-collapsed"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <button
            type="button"
            className="sidebar-icon-btn sidebar-brand-mini"
            title="展开边栏"
            onClick={onToggleCollapse}
          >
            <BrandLogo size={22} />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn"
            title="搜索会话 (⌘K)"
            onClick={() => {
              $sidebarAutoCollapsed.set(false)
              openSearch()
            }}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn new-chat-mini"
            title="新建会话"
            onClick={() => void onNewChat()}
          >
            +
          </button>
          <button
            type="button"
            className="sidebar-icon-btn"
            title="技能"
            onClick={() => void onOpenUtilityTab('skills')}
          >
            <SkillIcon />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn"
            title="工具"
            onClick={() => void onOpenUtilityTab('tools')}
          >
            <ToolIcon />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn"
            title="MCP"
            onClick={() => void onOpenUtilityTab('mcp')}
          >
            <McpIcon />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn"
            title="自动化任务"
            onClick={() => void onOpenUtilityTab('workflows')}
          >
            <WorkflowIcon />
          </button>
          <div className="sidebar-spacer" />
          <button
            type="button"
            className="sidebar-icon-btn"
            title="设置"
            onClick={onOpenSettings}
          >
            ⚙
          </button>
        </aside>

        {isPeekingOrLeaving && (
          <aside
            className={`sidebar sidebar-peek${peekState === 'leaving' ? ' is-leaving' : ''}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="sidebar-header" data-tauri-drag-region="true">
              <BrandWordmark size={22} />
              <div className="sidebar-actions">
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  title="搜索会话"
                  onClick={openSearch}
                >
                  <SearchIcon />
                </button>
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  title="收起边栏"
                  onClick={onToggleCollapse}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="sidebar-new-chat-wrapper">
              <button type="button" className="btn-new-chat" onClick={() => void onNewChat()}>
                <span className="plus-icon">+</span>
                <span>New chat</span>
              </button>
              <div className="sidebar-nav-row">
                <button
                  type="button"
                  className="sidebar-nav-btn"
                  onClick={() => void onOpenUtilityTab('skills')}
                >
                  <SkillIcon />
                  <span>技能</span>
                </button>
                <button
                  type="button"
                  className="sidebar-nav-btn"
                  onClick={() => void onOpenUtilityTab('tools')}
                >
                  <ToolIcon />
                  <span>工具</span>
                </button>
                <button
                  type="button"
                  className="sidebar-nav-btn"
                  onClick={() => void onOpenUtilityTab('mcp')}
                >
                  <McpIcon />
                  <span>MCP</span>
                </button>
                <button
                  type="button"
                  className="sidebar-nav-btn"
                  onClick={() => void onOpenUtilityTab('workflows')}
                >
                  <WorkflowIcon />
                  <span>自动化任务</span>
                </button>
              </div>
            </div>

            <div className="sidebar-recent-list" ref={listRef}>
              {workspaceGroups.map((ws) => {
                const folded = isWorkspaceCollapsed(ws)
                return (
                  <div
                    key={ws.cwdKey}
                    className={`sidebar-workspace${ws.isCurrent ? ' is-current' : ''}${folded ? ' is-collapsed' : ''}`}
                  >
                    <button
                      type="button"
                      className="sidebar-workspace-title"
                      title={ws.fullPath}
                      aria-expanded={!folded}
                      onClick={() => toggleWorkspace(ws)}
                    >
                      <FolderIcon open={!folded} />
                      <span className="sidebar-workspace-name">{ws.label}</span>
                    </button>
                    <CollapsibleWorkspaceBody open={!folded}>
                      <div className="sidebar-group">
                        {ws.chats.map((chat) => (
                          <ChatRow
                            key={chat.id}
                            chat={chat}
                            isActive={chat.id === activeChatId}
                            menuOpen={menuOpenChatId === chat.id}
                            onSelect={() => void onSelectChat(chat.id, chat.cwd)}
                            onOpenMenu={() =>
                              setMenuOpenChatId((id) =>
                                id === chat.id ? null : chat.id,
                              )
                            }
                            onRename={() => {
                              setMenuOpenChatId(null)
                              setRenameChat(chat)
                              setRenameInput(chat.title)
                              setRenameError(null)
                            }}
                            onDelete={() => {
                              setMenuOpenChatId(null)
                              setConfirmDelete(chat)
                            }}
                          />
                        ))}
                      </div>
                    </CollapsibleWorkspaceBody>
                  </div>
                )
              })}
              {workspaceGroups.length === 0 && (
                <p className="sidebar-empty-hint">暂无历史会话</p>
              )}
            </div>

            <div className="sidebar-footer">
              <div className="user-profile">
                <div className="user-avatar">👤</div>
                <span className="user-name">My Account</span>
              </div>
              <button
                type="button"
                className="sidebar-icon-btn"
                title="设置"
                onClick={onOpenSettings}
              >
                ⚙
              </button>
            </div>
          </aside>
        )}
      </>
    )
  }

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-header" data-tauri-drag-region="true">
          <BrandWordmark size={22} />
          <div className="sidebar-actions">
            <button
              type="button"
              className="sidebar-icon-btn"
              title="搜索会话"
              onClick={openSearch}
            >
              <SearchIcon />
            </button>
            <button
              type="button"
              className="sidebar-icon-btn"
              title="收起边栏"
              onClick={onToggleCollapse}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="sidebar-new-chat-wrapper">
          <button type="button" className="btn-new-chat" onClick={() => void onNewChat()}>
            <span className="plus-icon">+</span>
            <span>New chat</span>
          </button>
          <div className="sidebar-nav-row">
            <button
              type="button"
              className="sidebar-nav-btn"
              onClick={() => void onOpenUtilityTab('skills')}
            >
              <SkillIcon />
              <span>技能</span>
            </button>
            <button
              type="button"
              className="sidebar-nav-btn"
              onClick={() => void onOpenUtilityTab('tools')}
            >
              <ToolIcon />
              <span>工具</span>
            </button>
            <button
              type="button"
              className="sidebar-nav-btn"
              onClick={() => void onOpenUtilityTab('mcp')}
            >
              <McpIcon />
              <span>MCP</span>
            </button>
            <button
              type="button"
              className="sidebar-nav-btn"
              onClick={() => void onOpenUtilityTab('workflows')}
            >
              <WorkflowIcon />
              <span>自动化任务</span>
            </button>
          </div>
        </div>

        <div className="sidebar-recent-list" ref={listRef}>
          {workspaceGroups.map((ws) => {
              const folded = isWorkspaceCollapsed(ws)
              return (
                <div
                  key={ws.cwdKey}
                  className={`sidebar-workspace${ws.isCurrent ? ' is-current' : ''}${folded ? ' is-collapsed' : ''}`}
                >
                  <button
                    type="button"
                    className="sidebar-workspace-title"
                    title={ws.fullPath}
                    aria-expanded={!folded}
                    onClick={() => toggleWorkspace(ws)}
                  >
                    <FolderIcon open={!folded} />
                    <span className="sidebar-workspace-name">{ws.label}</span>
                  </button>
                  <CollapsibleWorkspaceBody open={!folded}>
                    <div className="sidebar-group">
                      {ws.chats.map((chat) => (
                        <ChatRow
                          key={chat.id}
                          chat={chat}
                          isActive={chat.id === activeChatId}
                          menuOpen={menuOpenChatId === chat.id}
                          onSelect={() => void onSelectChat(chat.id, chat.cwd)}
                          onOpenMenu={() =>
                            setMenuOpenChatId((id) =>
                              id === chat.id ? null : chat.id,
                            )
                          }
                          onRename={() => {
                            setMenuOpenChatId(null)
                            setRenameChat(chat)
                            setRenameInput(chat.title)
                            setRenameError(null)
                          }}
                          onDelete={() => {
                            setMenuOpenChatId(null)
                            setConfirmDelete(chat)
                          }}
                        />
                      ))}
                    </div>
                  </CollapsibleWorkspaceBody>
                </div>
              )
            })}
          {workspaceGroups.length === 0 && (
            <p className="sidebar-empty-hint">暂无历史会话</p>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">👤</div>
            <span className="user-name">My Account</span>
          </div>
          <button
            type="button"
            className="sidebar-icon-btn"
            title="设置"
            onClick={onOpenSettings}
          >
            ⚙
          </button>
        </div>
      </aside>

      {/* 会话搜索弹层（旧版样式） */}
      {searchOpen && (
        <div className="search-overlay" onClick={closeSearch}>
          <div
            className="search-panel"
            role="dialog"
            aria-modal="true"
            aria-label="搜索会话"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="search-panel-header">
              <span className="search-panel-icon" aria-hidden>
                <SearchIcon />
              </span>
              <input
                ref={searchInputRef}
                type="text"
                className="search-panel-input"
                placeholder="搜索会话…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className="search-panel-close"
                title="关闭"
                onClick={closeSearch}
              >
                ✕
              </button>
            </div>
            <div className="search-panel-body">
              {searchError ? (
                <div className="search-empty">搜索失败：{searchError}</div>
              ) : searchLoading ? (
                <div className="search-empty">搜索中…</div>
              ) : searchQuery.trim() && searchHits.length === 0 ? (
                <div className="search-empty">
                  {searchBootstrapping
                    ? '索引建立中，请稍后再试…'
                    : '没有匹配的会话'}
                </div>
              ) : !searchQuery.trim() ? (
                <div className="search-empty">
                  {chats.length === 0 ? '暂无会话记录' : '输入关键词搜索标题或对话内容'}
                </div>
              ) : (
                <ul className="search-result-list">
                  {searchHits.map((chat) => (
                    <li key={chat.id}>
                      <button
                        type="button"
                        className={`search-result-item${chat.id === activeChatId ? ' active' : ''}`}
                        onClick={() => handlePickSearchResult(chat)}
                      >
                        <span className="search-result-icon" aria-hidden>
                          <ChatBubbleIcon />
                        </span>
                        <span className="search-result-main">
                          <span className="search-result-title" title={chat.title}>
                            {chat.title}
                          </span>
                          {chat.snippet ? (
                            <span className="search-result-cwd" title={chat.snippet}>
                              {chat.snippet}
                            </span>
                          ) : chat.cwd ? (
                            <span
                              className="search-result-cwd"
                              title={chat.cwd}
                            >
                              {workspaceDisplayName(chat.cwd)}
                            </span>
                          ) : null}
                        </span>
                        <span className="search-result-time">
                          {formatSearchTimeLabel(chat.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirmDelete(null)}>
          <div
            className="modal-card confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>确认删除对话？</h2>
              <button
                type="button"
                className="close-btn"
                onClick={() => setConfirmDelete(null)}
              >
                ✕
              </button>
            </div>
            <p className="confirm-modal-text">
              确定要删除「<strong>{confirmDelete.title}</strong>
              」吗？删除后此对话记录将无法恢复。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setConfirmDelete(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void handleDelete(confirmDelete)}
              >
                {busy ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名 */}
      {renameChat && (
        <div className="modal-backdrop" onClick={() => !busy && setRenameChat(null)}>
          <div
            className="modal-card confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>重命名对话</h2>
              <button
                type="button"
                className="close-btn"
                onClick={() => setRenameChat(null)}
              >
                ✕
              </button>
            </div>
            <input
              className="settings-input"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename()
              }}
              autoFocus
            />
            {renameError && <p className="confirm-modal-error">{renameError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setRenameChat(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void handleRename()}
              >
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ChatRow({
  chat,
  isActive,
  menuOpen,
  onSelect,
  onOpenMenu,
  onRename,
  onDelete,
}: {
  chat: ChatSummary
  isActive: boolean
  menuOpen: boolean
  onSelect: () => void
  onOpenMenu: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className={`recent-item-container${isActive ? ' active' : ''}`}>
      <button type="button" className="recent-item" onClick={onSelect}>
        <span className="recent-title" title={chat.title}>
          {chat.title}
        </span>
      </button>
      <button
        type="button"
        className={`recent-more-btn${menuOpen ? ' open' : ''}`}
        title="更多操作"
        onClick={(e) => {
          e.stopPropagation()
          onOpenMenu()
        }}
      >
        ⋮
      </button>
      {menuOpen && (
        <div className="recent-menu place-bottom" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="recent-menu-item" onClick={onRename}>
            ✎ 重命名
          </button>
          <button type="button" className="recent-menu-item danger" onClick={onDelete}>
            🗑 删除对话
          </button>
        </div>
      )}
    </div>
  )
}
