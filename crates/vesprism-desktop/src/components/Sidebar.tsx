/**
 * 侧栏 — Cursor / Claude 式工作台导航：
 * 顶栏操作 · 主操作「新建」· 能力入口 · 工作区折叠会话列表 · 底栏设置
 */
import { useStore } from '@nanostores/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  $activeTabId,
  $chats,
  $defaultModelId,
  $engineStatus,
  $models,
  $reasoningEffort,
  $runningByParent,
  $settingsOpen,
  $sidebarAutoCollapsed,
  $sidebarCollapsed,
  $commandPaletteOpen,
  createTab,
  findNormalChatTab,
  cwdAfterLoadSession,
  findTabBySessionId,
  getTabState,
  isBlankNewChat,
  looksAbsolutePath,
  patchActiveTab,
  patchTab,
  resolveNewTabModel,
  resolveHistoryLoadCwd,
  resolveWorkspaceCwd,
  sessionTabReadyToReuse,
  switchTab,
  $workspaceCwd,
  $preferredWorkspaceCwd,
  $registeredProjects,
  $scratchCwd,
  isScratchCwd,
  $appShell,
  $utilityKind,
  type ChatSummary,
  type UtilityKind,
} from '../store'
import {
  getProduct,
  isProductSessionGroup,
  navLabelForKind,
  usesEngineSessionList,
  type ProductNavKind,
} from '../products/catalog'
import { clearSessionAllowed } from '../lib/permissionMemory'
import { isWritingSessionCwd } from '../lib/writingCwd'
import { formatEngineError } from '../lib/errorMessage'
import { tabStates, pushToast } from '../store'
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  loadSession,
  openTab,
  removeProject,
  renameSession,
  restartSession,
  searchSessions,
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
import { WritingLibraryNav } from '../writing/chrome/LibraryNav'
import { spawnReasoningEffort } from '../lib/reasoning'
import { openSessionSchedule } from '../lib/engineSlash'
import { normalizeWorkspacePath, workspaceFolderName } from '../lib/workspacePath'
import {
  refreshRegisteredProjects,
  registerAndSwitchWorkspace,
} from '../lib/workspaceSwitch'
import { ShellSwitch } from './ShellSwitch'
import { openWorkbenchHistory } from '../lib/openWorkbenchSession'
import {
  CHATS_CHANGED_EVENT,
  preserveActiveLiveChat,
} from '../lib/recordSessionInSidebar'
import { reconcileRunningSubagents } from '../lib/reconcileRunningSubagents'
import {
  getWorkbenchBinding,
  isToolSession,
  listWorkbenchBindings,
  listWorkbenchSessions,
  type WorkbenchBinding,
} from '../workbench/bindings'



/** FTS 搜索结果行（可带 snippet） */
type SearchHit = ChatSummary & { snippet?: string }

/** 工作台历史：定位产物，并把该会话聊天灌进画布/编制 Tab。 */
async function openBoundWorkbenchWithBinding(
  binding: WorkbenchBinding,
  sessionTitle?: string,
  sessionCwd?: string,
): Promise<void> {
  await openWorkbenchHistory({
    sessionId: binding.session_id,
    binding,
    title: sessionTitle,
    cwd: sessionCwd,
  })
}

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

/** 侧栏图标统一 16×16，避免收纳/展开光学校准不一致 */
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

function WorkflowIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="7" cy="8" r="2" />
      <circle cx="17" cy="12" r="2" />
      <circle cx="7" cy="16" r="2" />
      <path d="M9 8h4.5a3.5 3.5 0 0 1 3.5 3.5M9 16h4.5A3.5 3.5 0 0 0 17 12.5" />
    </svg>
  )
}

function ScheduleIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8.5v4l2.5 1.5" />
    </svg>
  )
}

function FlowCanvasIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4.5" y="5.5" width="6" height="5" rx="1" />
      <rect x="13.5" y="13.5" width="6" height="5" rx="1" />
      <path d="M10.5 8h3.2a2 2 0 0 1 2 2v3.5" />
    </svg>
  )
}

function AgentsIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="2.4" />
      <path d="M6.5 18c.6-3 2.8-4.6 5.5-4.6S16.9 15 17.5 18" />
    </svg>
  )
}

function WritingDeskIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 4h8l3 3v13H7z" />
      <path d="M15 4v3h3" />
      <path d="M10 11h6M10 15h4" strokeLinecap="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

function GenericNavIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

function iconForNavKind(kind: ProductNavKind) {
  if (kind === 'schedule') return ScheduleIcon
  if (kind === 'workflows') return WorkflowIcon
  if (kind === 'flow-canvas') return FlowCanvasIcon
  if (kind === 'agents') return AgentsIcon
  if (kind === 'writing-desk') return WritingDeskIcon
  return GenericNavIcon
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
  return normalizeWorkspacePath(cwd || '') || '(未知工作空间)'
}

/** 工作台分组 key 来自产品表，不参与 cwd 分组。 */
const WORKBENCH_GROUP_KEY = getProduct('workbench').sessionGroupKey ?? '__workbench__'
const WRITING_GROUP_KEY = getProduct('writing').sessionGroupKey ?? '__writing__'
/** 闲聊分组（scratch cwd，未绑定项目）专用 key。 */
const CASUAL_GROUP_KEY = '__casual__'

function workspaceDisplayName(cwd: string): string {
  const key = normalizeCwdKey(cwd)
  if (key === '(未知工作空间)') return key
  if (isScratchCwd(cwd)) return '闲聊'
  return workspaceFolderName(cwd)
}

type WorkspaceGroup = {
  cwdKey: string
  label: string
  fullPath: string
  isCurrent: boolean
  /** 钉在项目表里，可从侧栏摘掉（会话还在磁盘上）。 */
  registered: boolean
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
  const registeredProjects = useStore($registeredProjects)
  /** 主工作区：侧栏置顶/默认展开；勿用当前 Tab cwd（点历史会误把整组拖到最上面） */
  const preferredCwd = useStore($preferredWorkspaceCwd)
  const scratchCwd = useStore($scratchCwd)
  const appShell = useStore($appShell)
  const utilityKind = useStore($utilityKind)
  const product = getProduct(appShell)

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
  const [workbenchChats, setWorkbenchChats] = useState<ChatSummary[]>([])
  const [workbenchBindings, setWorkbenchBindings] = useState<Record<string, WorkbenchBinding>>({})

  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchGenRef = useRef(0)

  const refreshWorkbenchChats = useCallback(async () => {
    try {
      const list = await listWorkbenchSessions(300)
      setWorkbenchChats(
        list.map((c) => ({
          id: c.id,
          title: c.title || '工作台会话',
          cwd: c.cwd,
          updatedAt: c.updated_at,
        })),
      )
    } catch (e) {
      console.warn('刷新工作台会话失败', e)
    }
  }, [])

  const refreshChats = useCallback(async (workspace?: string) => {
    // 用主工作区做「当前优先」排序参数；列表本身含全部 cwd 的会话
    const w =
      workspace ||
      $preferredWorkspaceCwd.get() ||
      $workspaceCwd.get()
    try {
      const [list] = await Promise.all([
        w ? listSessions(w, 300) : Promise.resolve(null),
        refreshWorkbenchChats(),
      ])
      if (list) {
        $chats.set(
          preserveActiveLiveChat(
            list.map((c) => ({
              id: c.id,
              title: c.title || '新对话',
              cwd: c.cwd,
              updatedAt: c.updated_at,
            })),
          ),
        )
      }
    } catch (e) {
      console.warn('刷新会话列表失败', e)
    }
  }, [refreshWorkbenchChats])

  // 仅主工作区变化时刷新列表；切 Tab / 打开其它 cwd 历史不重排侧栏
  useEffect(() => {
    if (!preferredCwd) return
    void refreshChats(preferredCwd)
  }, [preferredCwd, refreshChats])

  useEffect(() => {
    void refreshRegisteredProjects().catch(() => { })
  }, [])

  useEffect(() => {
    void refreshWorkbenchChats()
  }, [refreshWorkbenchChats])

  useEffect(() => {
    let timer = 0
    const onChanged = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void refreshChats()
      }, 160)
    }
    window.addEventListener(CHATS_CHANGED_EVENT, onChanged)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(CHATS_CHANGED_EVENT, onChanged)
    }
  }, [refreshChats])

  useEffect(() => {
    let cancelled = false
      ; (async () => {
        try {
          const ids = [
            ...chats.map((chat) => chat.id),
            ...workbenchChats.map((chat) => chat.id),
          ]
          const bindings = await listWorkbenchBindings(ids)
          if (cancelled) return
          setWorkbenchBindings(
            Object.fromEntries(bindings.map((binding) => [binding.session_id, binding])),
          )
        } catch {
          if (!cancelled) setWorkbenchBindings({})
        }
      })()
    return () => {
      cancelled = true
    }
  }, [chats, workbenchChats])

  useEffect(() => {
    const onChanged = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId?.trim()
      if (!sessionId) return
      void refreshWorkbenchChats()
      void getWorkbenchBinding(sessionId)
        .then((binding) => {
          setWorkbenchBindings((prev) => {
            const next = { ...prev }
            if (binding) next[sessionId] = binding
            else delete next[sessionId]
            return next
          })
        })
        .catch(() => { })
    }
    window.addEventListener('vesprism:workbench-binding-changed', onChanged)
    return () => window.removeEventListener('vesprism:workbench-binding-changed', onChanged)
  }, [refreshWorkbenchChats])

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
    // 工作台会话走独立列表，不和主聊天混；主列表里若还有绑定残留也归过去。
    const workbenchIds = new Set(workbenchChats.map((c) => c.id))
    const casual: ChatSummary[] = []
    const byWs = new Map<string, ChatSummary[]>()
    for (const c of chats) {
      if (workbenchIds.has(c.id) || workbenchBindings[c.id]?.artifacts?.length) {
        continue
      }
      if (isScratchCwd(c.cwd, scratchCwd)) {
        casual.push(c)
        continue
      }
      const key = isWritingSessionCwd(c.cwd) ? WRITING_GROUP_KEY : normalizeCwdKey(c.cwd)
      if (!byWs.has(key)) byWs.set(key, [])
      byWs.get(key)!.push(c)
    }
    const groups: WorkspaceGroup[] = []
    if (workbenchChats.length > 0) {
      groups.push({
        cwdKey: WORKBENCH_GROUP_KEY,
        label: '工作台',
        fullPath: '',
        isCurrent: true,
        registered: false,
        chats: [...workbenchChats].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
      })
    }
    if (casual.length > 0) {
      groups.push({
        cwdKey: CASUAL_GROUP_KEY,
        label: '闲聊',
        fullPath: scratchCwd || '',
        isCurrent: true,
        registered: false,
        chats: [...casual].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
      })
    }
    const registeredKeys = new Set(
      registeredProjects.map((root) => normalizeCwdKey(root)).filter((k) => k !== '(未知工作空间)'),
    )
    for (const [key, list] of byWs) {
      const sorted = [...list].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      groups.push({
        cwdKey: key,
        label: key === WRITING_GROUP_KEY ? '写完' : workspaceDisplayName(key),
        fullPath: key === WRITING_GROUP_KEY ? '' : key,
        isCurrent: Boolean(pinKey) && key === pinKey,
        registered: registeredKeys.has(key),
        chats: sorted,
      })
    }
    for (const root of registeredProjects) {
      if (isScratchCwd(root, scratchCwd)) continue
      const key = normalizeCwdKey(root)
      if (key === '(未知工作空间)' || byWs.has(key)) continue
      groups.push({
        cwdKey: key,
        label: workspaceDisplayName(root),
        fullPath: root,
        isCurrent: Boolean(pinKey) && key === pinKey,
        registered: true,
        chats: [],
      })
    }
    groups.sort((a, b) => {
      const rank = (g: WorkspaceGroup) => {
        if (g.cwdKey === WORKBENCH_GROUP_KEY) return 0
        if (g.cwdKey === WRITING_GROUP_KEY) return 1
        if (g.cwdKey === CASUAL_GROUP_KEY) return 2
        if (g.isCurrent) return 2
        return 3
      }
      const d = rank(a) - rank(b)
      if (d !== 0) return d
      return a.label.localeCompare(b.label, 'zh')
    })
    return groups
  }, [chats, workbenchChats, preferredCwd, cwd, scratchCwd, workbenchBindings, registeredProjects])

  const onWorkspaceTitleClick = (ws: WorkspaceGroup) => {
    toggleWorkspace(ws)
  }

  /** 添加项目：系统文件夹选择，不弹已有仓库列表。 */
  const browseProjectFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        defaultPath: preferredCwd || cwd || undefined,
      })
      if (typeof selected !== 'string' || !selected.trim()) return
      await registerAndSwitchWorkspace(selected.trim())
      await refreshChats()
    } catch (e) {
      patchActiveTab({ error: String(e) })
    }
  }

  const onRemoveProject = async (ws: WorkspaceGroup, e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await removeProject(ws.fullPath)
      await refreshRegisteredProjects()
      await refreshChats()
    } catch (err) {
      patchActiveTab({ error: String(err) })
    }
  }

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
  const onSelectChat = useCallback(async (
    id: string,
    sessionCwd?: string,
    restoreCode = false,
  ) => {
    setMenuOpenChatId(null)

    // 有产物绑定的干活会话：直接跳工作台面板（画布/编制）并定位，
    // 不先切聊天区再跳（避免「闪到主聊天又闪到工作台」）。
    let bound: WorkbenchBinding | null = null
    try {
      bound = await getWorkbenchBinding(id)
    } catch {
      bound = null
    }
    if (bound && bound.artifacts.length > 0) {
      const listed =
        workbenchChats.find((c) => c.id === id) || $chats.get().find((c) => c.id === id)
      await openBoundWorkbenchWithBinding(
        bound,
        listed?.title?.trim() || '',
        listed?.cwd || sessionCwd,
      )
      return
    }
    try {
      if (await isToolSession(id)) {
        const listed =
          workbenchChats.find((c) => c.id === id) || $chats.get().find((c) => c.id === id)
        await openWorkbenchHistory({
          sessionId: id,
          binding: { session_id: id, artifacts: [], updated_at_ms: 0 },
          title: listed?.title?.trim() || '流程画布',
          cwd: listed?.cwd || sessionCwd,
        })
        return
      }
    } catch {
      /* 索引不可用时按普通历史打开 */
    }

    const existing = findTabBySessionId(id)
    if (existing && sessionTabReadyToReuse(getTabState(existing), id) && !restoreCode) {
      switchTab(existing)
      return
    }

    const title =
      $chats.get().find((c) => c.id === id)?.title?.trim() || '历史会话'
    const workCwd = resolveHistoryLoadCwd(sessionCwd || cwd)
    if (!workCwd || !looksAbsolutePath(workCwd)) {
      patchActiveTab({
        error: '工作区路径无效，无法打开历史会话。请在设置中选择绝对路径工作区。',
      })
      return
    }

    const activeId = $activeTabId.get()
    const active = activeId ? getTabState(activeId) : undefined
    const reuseBroken = Boolean(existing)
    const reuseBlank =
      !reuseBroken &&
      Boolean(activeId) &&
      Boolean(active) &&
      isBlankNewChat(active!) &&
      active!.phase !== 'loading' &&
      active!.phase !== 'restarting' &&
      active!.status !== 'generating'

    let myTab = activeId
    let createdNew = false
    if (existing) {
      myTab = existing
    } else if (!reuseBlank) {
      // 新 Tab：先创建不切换，等有消息再 switch，用户可继续在当前 Tab 操作
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
        mcpElicit: null,
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
      if (createdNew || reuseBlank || reuseBroken) {
        switchTab(myTab)
      }

      beginAttachRuntime(myTab)
      // 不传 tab 上的默认 effort，避免盖掉该历史会话自己记住的思考强度
      const used = await loadSession(myTab, id, workCwd, restoreCode || undefined)
      const attachedCwd = cwdAfterLoadSession(used, workCwd)
      // 启动对账：恢复该会话仍在运行的子 agent（重启/重连场景，官方 x.ai/subagent/list_running）
      void reconcileRunningSubagents(myTab)
      if (gen !== currentLoadGen(myTab)) return
      finishAttachRuntime(myTab)
      // chatId 固定为侧栏历史 id，便于再次点击时命中已开 Tab
      patchTab(myTab, {
        sessionId: id,
        chatId: id,
        cwd: attachedCwd,
        phase: 'ready',
        status: 'idle',
        error: '',
      })
      cacheSessionMessages(id, getTabState(myTab)?.messages ?? [])
      if (restoreCode) pushToast('已按这场对话的代码快照恢复工作区', 'info')
    } catch (e) {
      if (gen !== currentLoadGen(myTab)) return
      abortOpenSession(myTab)
      const err = formatEngineError(e)
      // 记录已经画出来了：别拆掉 Tab。没接上引擎不是「会话没启动」。
      patchTab(myTab, { phase: 'ready', status: 'idle', error: err, cwd: workCwd })
      if (createdNew || reuseBroken) switchTab(myTab)
    }
  }, [cwd, workbenchChats])

  const handlePickSearchResult = (chat: SearchHit) => {
    closeSearch()
    void onSelectChat(chat.id, chat.cwd)
  }

  const onNewChat = useCallback(async () => {
    setMenuOpenChatId(null)

    const workCwd = resolveWorkspaceCwd() || $scratchCwd.get()
    if (!workCwd || !looksAbsolutePath(workCwd)) {
      patchActiveTab({
        error: '无法创建会话：闲聊目录不可用。',
      })
      return
    }

    // 软上限：超过提示但不硬拦（空白 tab 切走会自动回收）
    if (tabStates.size >= MAX_TABS) {
      pushToast(`已有 ${MAX_TABS} 个标签页，建议先关闭不用的`, 'info')
    }

    const activeId = $activeTabId.get()
    const activeState = activeId ? getTabState(activeId) : undefined
    const isBlank = activeState ? isBlankNewChat(activeState) : false

    // 当前 Tab 非空白普通对话（加载历史 / 生成中 / 有消息 / 专用面板）：新开空白对话 Tab
    const shouldOpenFreshTab =
      !activeId ||
      !activeState ||
      !isBlank ||
      activeState.phase === 'loading' ||
      activeState.phase === 'restarting' ||
      activeState.phase === 'booting' ||
      activeState.status === 'generating'

    if (shouldOpenFreshTab) {
      // 优先复用已有空白普通对话
      const blank = findNormalChatTab(true)
      if (
        blank &&
        blank !== activeId &&
        getTabState(blank) &&
        isBlankNewChat(getTabState(blank)!)
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
        mcpElicit: null,
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

      const modelId = $defaultModelId.get().trim()
      const entry = $models.get().find((m) => m.id === modelId)
      const effort = spawnReasoningEffort(entry, $reasoningEffort.get())
      const spawn = { modelId: modelId || undefined, reasoningEffort: effort }
      try {
        await restartSession(tabId, workCwd, spawn)
      } catch {
        await startSession(tabId, workCwd, spawn)
      }
      if (effort) $reasoningEffort.set(effort)

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
    window.addEventListener('vesprism:new-chat', onNew)
    window.addEventListener('vesprism:open-chat', onOpen)
    return () => {
      window.removeEventListener('vesprism:new-chat', onNew)
      window.removeEventListener('vesprism:open-chat', onOpen)
    }
  }, [onNewChat, onSelectChat])

  const handleDelete = async (chat: ChatSummary) => {
    setBusy(true)
    try {
      await deleteSession($activeTabId.get(), chat.id, chat.cwd || cwd)
      invalidateSessionMessages(chat.id)
      if (chat.id === activeChatId) {
        patchActiveTab({ messages: [], chatId: '' })
        const tabId = $activeTabId.get()
        const st = getTabState(tabId)
        const spawn = { modelId: st?.modelId, reasoningEffort: st?.reasoningEffort }
        try {
          await restartSession(tabId, cwd, spawn)
        } catch {
          await startSession(tabId, cwd, spawn)
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
  /** 手动点「收起」后抑制 hover peek，直到鼠标离开图标轨（否则会立刻又浮出） */
  const peekSuppressRef = useRef(false)

  const clearPeekTimer = () => {
    if (peekTimerRef.current !== null) {
      window.clearTimeout(peekTimerRef.current)
      peekTimerRef.current = null
    }
  }

  /**
   * Peek 仅在「图标轨下方热区」触发，不含顶部展开按钮。
   * 否则悬停展开钮 140ms 后浮层盖住，点不到。
   */
  const PEEK_HOVER_OPEN_MS = 320
  const PEEK_LEAVE_GRACE_MS = 160

  /** 悬停在下方热区：打开 peek */
  const handlePeekZoneEnter = () => {
    if (!collapsed) return
    if (peekSuppressRef.current) return
    clearPeekTimer()
    if (peekState === 'leaving') {
      setPeekState('peeking')
      return
    }
    if (peekState === 'peeking') return
    peekTimerRef.current = window.setTimeout(() => {
      setPeekState('peeking')
    }, PEEK_HOVER_OPEN_MS)
  }

  const handlePeekZoneLeave = () => {
    clearPeekTimer()
    if (peekSuppressRef.current) {
      peekSuppressRef.current = false
      if (peekState === 'closed') return
    }
    peekTimerRef.current = window.setTimeout(() => {
      setPeekState('closed')
    }, PEEK_LEAVE_GRACE_MS)
  }

  /** 顶部展开钮：绝不触发 peek；若浮层已开则立刻关掉以便点击 */
  const handleExpandBtnEnter = () => {
    clearPeekTimer()
    peekSuppressRef.current = true
    if (peekState !== 'closed') {
      setPeekState('closed')
    }
  }

  const handleExpandBtnLeave = () => {
    peekSuppressRef.current = false
  }

  /** 展开态 → 收纳；并抑制紧接着的 hover peek */
  const collapseSidebar = () => {
    clearPeekTimer()
    peekSuppressRef.current = true
    setPeekState('closed')
    $sidebarCollapsed.set(true)
    $sidebarAutoCollapsed.set(false)
  }

  /** 收纳轨 → 固定展开 */
  const expandSidebar = () => {
    clearPeekTimer()
    peekSuppressRef.current = false
    setPeekState('closed')
    $sidebarCollapsed.set(false)
    $sidebarAutoCollapsed.set(false)
  }

  /**
   * 顶栏「面板」按钮：
   * - 固定展开时：收起
   * - hover peek 浮层时：关掉浮层并保持收纳（不要误当成 toggle 展开）
   */
  const onHeaderCollapseClick = () => {
    if (collapsed) {
      clearPeekTimer()
      peekSuppressRef.current = true
      setPeekState('closed')
      return
    }
    collapseSidebar()
  }

  const onOpenSettings = () => {
    $settingsOpen.set(true)
  }

  /** 侧栏产品入口：开专用 Tab；schedule 只打开当前会话的定时面板。 */
  const onOpenUtilityTab = useCallback(async (kind: UtilityKind) => {
    setMenuOpenChatId(null)
    await openChatTab({ title: navLabelForKind(kind), utilityKind: kind })
  }, [])

  const onProductNav = useCallback(
    (kind: ProductNavKind) => {
      if (kind === 'schedule') openSessionSchedule()
      else void onOpenUtilityTab(kind)
    },
    [onOpenUtilityTab],
  )

  const renderUtilityGrid = () => (
    <nav className="sidebar-compose-nav" aria-label={product.sidebarNavLabel}>
      {product.sidebarEntries.map(({ kind, label }) => {
        const Icon = iconForNavKind(kind)
        return (
          <button
            key={kind}
            type="button"
            className={`sidebar-compose-link${utilityKind === kind ? ' is-active' : ''}`}
            title={label}
            onClick={() => onProductNav(kind)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )

  const renderSessionList = () => {
    if (!usesEngineSessionList(product)) return null
    return (
    <div className="sidebar-recent-list" ref={listRef}>
      {workspaceGroups
        .filter((ws) =>
          product.sessionList === 'product'
            ? ws.cwdKey === (product.sessionGroupKey ?? '')
            : !isProductSessionGroup(ws.cwdKey),
        )
        .map((ws) => {
        const folded = isWorkspaceCollapsed(ws)
        return (
          <div
            key={ws.cwdKey}
            className={`sidebar-workspace${ws.isCurrent ? ' is-current' : ''}${folded ? ' is-collapsed' : ''}${ws.cwdKey === CASUAL_GROUP_KEY ? ' is-casual' : ''}${ws.cwdKey === WORKBENCH_GROUP_KEY ? ' is-workbench' : ''}`}
          >
            <div className="sidebar-workspace-title-row">
            <button
              type="button"
              className="sidebar-workspace-title"
              title={
                ws.cwdKey === CASUAL_GROUP_KEY
                  ? '未绑定项目的会话'
                  : ws.cwdKey === WORKBENCH_GROUP_KEY
                    ? '画布 / 编制干活会话'
                    : ws.cwdKey === WRITING_GROUP_KEY
                      ? '写台书稿会话'
                      : ws.fullPath
              }
              aria-expanded={!folded}
              onClick={() => void onWorkspaceTitleClick(ws)}
            >
              <FolderIcon open={!folded} />
              <span className="sidebar-workspace-name">{ws.label}</span>
              <span className="sidebar-workspace-count">{ws.chats.length}</span>
            </button>
            {ws.registered ? (
              <button
                type="button"
                className="sidebar-workspace-remove"
                title="从项目列表移除（不删除会话）"
                aria-label={`移除项目 ${ws.label}`}
                onClick={(e) => void onRemoveProject(ws, e)}
              >
                ×
              </button>
            ) : null}
            </div>
            <CollapsibleWorkspaceBody open={!folded}>
              <div className="sidebar-group">
                {ws.chats.length === 0 ? (
                  <p className="sidebar-group-empty">此项目还没有会话</p>
                ) : null}
                {ws.chats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    binding={workbenchBindings[chat.id]}
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
                    onRestoreCode={() => {
                      setMenuOpenChatId(null)
                      void onSelectChat(chat.id, chat.cwd, true)
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
      {workspaceGroups.filter((ws) =>
        product.sessionList === 'product'
          ? ws.cwdKey === (product.sessionGroupKey ?? '')
          : !isProductSessionGroup(ws.cwdKey),
      ).length === 0 && (
        <p className="sidebar-empty-hint">{product.emptyHint}</p>
      )}
    </div>
  )
  }

  /** 展开态 / peek 共用：壳切换 → 新对话 → 能力入口 → 会话 → 设置 */
  const renderExpandedPanel = () => (
    <>
      <div className="sidebar-head">
        <div className="sidebar-top-bar">
          <ShellSwitch />
          <div className="sidebar-top-actions">
            {usesEngineSessionList(product) ? (
            <button
              type="button"
              className="sidebar-icon-btn"
              title="搜索会话 (⌘K)"
              onClick={openSearch}
            >
              <SearchIcon />
            </button>
            ) : null}
            <button
              type="button"
              className="sidebar-icon-btn"
              title={collapsed ? '关闭预览' : '收起边栏'}
              onClick={onHeaderCollapseClick}
            >
              <CollapseIcon />
            </button>
          </div>
        </div>
        {product.showNewChat && (
          <button
            type="button"
            className="sidebar-compose-new"
            onClick={() => void onNewChat()}
            title="新建对话"
          >
            <PlusIcon />
            <span>新对话</span>
          </button>
        )}
      </div>

      {usesEngineSessionList(product) ? (
        <div className="sidebar-compose">{renderUtilityGrid()}</div>
      ) : null}

      {!usesEngineSessionList(product) ? (
        <WritingLibraryNav />
      ) : (
        <>
      <div className="sidebar-section-label">
        <span>{product.sidebarListLabel}</span>
        {product.showAddProject && (
        <button
          type="button"
          className="sidebar-section-add"
          title="添加项目"
          aria-label="添加项目"
          onClick={() => void browseProjectFolder()}
        >
          +
        </button>
        )}
      </div>
      {renderSessionList()}
        </>
      )}

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-footer-btn"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
          <span>设置</span>
        </button>
      </div>
    </>
  )

  const isPeekingOrLeaving = collapsed && (peekState === 'peeking' || peekState === 'leaving')

  if (collapsed) {
    return (
      <>
        <aside
          className={`sidebar sidebar-collapsed${isPeekingOrLeaving ? ' is-peek-open' : ''}`}
        >
          {/* 顶部展开钮：独立于 peek 热区，可稳定点击 */}
          <button
            type="button"
            className="sidebar-icon-btn sidebar-brand-mini"
            title="展开边栏"
            onClick={expandSidebar}
            onMouseEnter={handleExpandBtnEnter}
            onMouseLeave={handleExpandBtnLeave}
          >
            <CollapseIcon />
          </button>
          {/* 仅此区域 hover 才出 peek 浮层 */}
          <div
            className="sidebar-rail-peek-zone"
            onMouseEnter={handlePeekZoneEnter}
            onMouseLeave={handlePeekZoneLeave}
          >
            <div className="sidebar-rail-divider" />
            {product.showNewChat ? (
              <>
            <button
              type="button"
              className="sidebar-icon-btn"
              title="新建会话"
              onClick={() => void onNewChat()}
            >
              <PlusIcon />
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
            <div className="sidebar-rail-divider" />
              </>
            ) : null}
            {usesEngineSessionList(product)
              ? product.sidebarEntries.map(({ kind, label }) => {
                  const Icon = iconForNavKind(kind)
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="sidebar-icon-btn"
                      title={label}
                      onClick={() => onProductNav(kind)}
                    >
                      <Icon />
                    </button>
                  )
                })
              : null}
            <div className="sidebar-spacer" />
            <button
              type="button"
              className="sidebar-icon-btn"
              title="设置"
              onClick={onOpenSettings}
            >
              <SettingsIcon />
            </button>
          </div>
        </aside>

        {isPeekingOrLeaving && (
          <>
            <div
              className={`sidebar-peek-scrim${peekState === 'leaving' ? ' is-leaving' : ''}`}
              aria-hidden
            />
            <aside
              className={`sidebar sidebar-peek${peekState === 'leaving' ? ' is-leaving' : ''}`}
              onMouseEnter={handlePeekZoneEnter}
              onMouseLeave={handlePeekZoneLeave}
            >
              {renderExpandedPanel()}
            </aside>
          </>
        )}
      </>
    )
  }

  return (
    <>
      <aside className="sidebar">
        {renderExpandedPanel()}
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
  binding,
  isActive,
  menuOpen,
  onSelect,
  onOpenMenu,
  onRename,
  onRestoreCode,
  onDelete,
}: {
  chat: ChatSummary
  binding?: WorkbenchBinding
  isActive: boolean
  menuOpen: boolean
  onSelect: () => void
  onOpenMenu: () => void
  onRename: () => void
  onRestoreCode: () => void
  onDelete: () => void
}) {
  const runningByParent = useStore($runningByParent)
  const runningCount = runningByParent[chat.id] ?? 0
  const artifacts = binding?.artifacts ?? []
  const flowCount = artifacts.filter((item) => item.kind === 'flow').length
  const agentCount = artifacts.filter((item) => item.kind === 'agent').length
  const hasWorkbenchArtifacts = flowCount > 0 || agentCount > 0
  const [confirmRestore, setConfirmRestore] = useState(false)
  useEffect(() => {
    if (!menuOpen) setConfirmRestore(false)
  }, [menuOpen])
  return (
    <div className={`recent-item-container${isActive ? ' active' : ''}`}>
      <button type="button" className="recent-item" onClick={onSelect}>
        <span className="recent-title" title={chat.title}>
          {chat.title}
        </span>
        {hasWorkbenchArtifacts && (
          <span className="recent-artifacts" aria-label="工作台产物">
            {flowCount > 0 && <span className="recent-artifact-pill" title={`${flowCount} 个流程`}>⑂ {flowCount}</span>}
            {agentCount > 0 && <span className="recent-artifact-pill" title={`${agentCount} 个员工`}>✦ {agentCount}</span>}
          </span>
        )}
        {runningCount > 0 && (
          <span className="recent-running-badge" title={`${runningCount} 个子代理运行中`}>
            ● {runningCount}
          </span>
        )}
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
          <button
            type="button"
            className="recent-menu-item"
            title="打开这场对话，并把工作区文件恢复成当时的快照。未提交改动可能被盖掉。"
            onClick={() => {
              if (!confirmRestore) {
                setConfirmRestore(true)
                return
              }
              setConfirmRestore(false)
              onRestoreCode()
            }}
          >
            {confirmRestore ? '再点确认：会改工作区文件' : '还原代码快照'}
          </button>
          <button type="button" className="recent-menu-item danger" onClick={onDelete}>
            🗑 删除对话
          </button>
        </div>
      )}
    </div>
  )
}
