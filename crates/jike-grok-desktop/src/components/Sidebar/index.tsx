import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RecentChat } from '../../types'
import { BrandLogo, BrandWordmark } from '../BrandLogo'

/**
 * 仅在侧栏列表容器内滚动，把 child 滚进可视区。
 * 不用 element.scrollIntoView：它会带动所有可滚动祖先，WebView 里常把列表「弹到顶」。
 */
function scrollChildIntoContainer(
  container: HTMLElement,
  child: HTMLElement,
  padding = 8,
): void {
  const cRect = container.getBoundingClientRect()
  const iRect = child.getBoundingClientRect()
  const topGap = iRect.top - cRect.top
  const bottomGap = cRect.bottom - iRect.bottom

  if (topGap >= padding && bottomGap >= padding) {
    // 已在可视区内：保持 scrollTop，避免跳动
    return
  }

  let next = container.scrollTop
  if (topGap < padding) {
    next += topGap - padding
  } else if (bottomGap < padding) {
    next += padding - bottomGap
  }

  const max = Math.max(0, container.scrollHeight - container.clientHeight)
  container.scrollTop = Math.max(0, Math.min(max, next))
}

/**
 * 工作空间子列表：展开挂载、收起卸载。
 * 不做高度动画，避免 WebView 留白 / 裁切 / 定时器竞态。
 */
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

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  recentChats: RecentChat[]
  activeChatId: string
  /** 当前 Agent 工作目录，用于标记「当前」工作空间并排在最前 */
  currentWorkspaceCwd?: string
  onSelectChat: (id: string, cwd?: string) => void
  onDeleteChat: (id: string, cwd?: string) => void
  /** 重命名会话标题（持久化）；返回 Promise 供弹窗显示错误 */
  onRenameChat: (id: string, title: string, cwd?: string) => Promise<void>
}

type GroupedChats = {
  groupName: string
  chats: RecentChat[]
}

/** 工作空间 → 其下再按时间分组 */
type WorkspaceGroup = {
  /** 规范化后的路径 key */
  cwdKey: string
  /** 展示用：文件夹名 + 可选「当前」 */
  label: string
  /** 完整路径，hover 看 */
  fullPath: string
  isCurrent: boolean
  dateGroups: GroupedChats[]
}

function normalizeCwdKey(cwd: string | undefined): string {
  return (cwd || '').trim().replace(/\\/g, '/').replace(/\/+$/, '') || '(未知工作空间)'
}

/** 侧栏工作空间标题：取最后一级目录名 */
function workspaceDisplayName(cwd: string): string {
  const key = normalizeCwdKey(cwd)
  if (key === '(未知工作空间)') return key
  const parts = key.split('/').filter(Boolean)
  return parts[parts.length - 1] || key
}

/** 本地日历日的「年月日」标题，例如 2026年7月20日 */
function formatDateGroupLabel(date: Date): string {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  return `${y}年${m}月${d}日`
}

/** 搜索结果右侧的相对时间标签 */
function formatSearchTimeLabel(chat: RecentChat): string {
  const source = chat.rawTimestamp || chat.timestamp
  if (!source) return ''
  const t = new Date(source).getTime()
  if (Number.isNaN(t)) return chat.timestamp || ''

  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (t >= todayStart) return '今天'
  if (t >= todayStart - dayMs) return '昨天'
  if (t >= todayStart - 2 * dayMs) return '前天'
  if (t >= todayStart - 6 * dayMs) return '过去 7 天'
  if (t >= todayStart - 29 * dayMs) return '过去 30 天'
  return formatDateGroupLabel(new Date(t))
}

/** 按本地日历日分组：今天 / 昨天 / 前天；更早按具体年月日分组 */
function groupChatsByDate(chats: RecentChat[]): GroupedChats[] {
  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - dayMs
  const dayBeforeYesterdayStart = todayStart - 2 * dayMs

  const todayChats: RecentChat[] = []
  const yesterdayChats: RecentChat[] = []
  const dayBeforeYesterdayChats: RecentChat[] = []
  const olderByDay = new Map<number, RecentChat[]>()
  const unknownChats: RecentChat[] = []

  for (const chat of chats) {
    const source = chat.rawTimestamp || chat.timestamp
    const rawTime = source ? new Date(source).getTime() : NaN
    if (!source || Number.isNaN(rawTime)) {
      unknownChats.push(chat)
    } else if (rawTime >= todayStart) {
      todayChats.push(chat)
    } else if (rawTime >= yesterdayStart) {
      yesterdayChats.push(chat)
    } else if (rawTime >= dayBeforeYesterdayStart) {
      dayBeforeYesterdayChats.push(chat)
    } else {
      const day = new Date(rawTime)
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
      const bucket = olderByDay.get(dayStart)
      if (bucket) {
        bucket.push(chat)
      } else {
        olderByDay.set(dayStart, [chat])
      }
    }
  }

  const groups: GroupedChats[] = []
  if (todayChats.length > 0) groups.push({ groupName: '今天', chats: todayChats })
  if (yesterdayChats.length > 0) groups.push({ groupName: '昨天', chats: yesterdayChats })
  if (dayBeforeYesterdayChats.length > 0) {
    groups.push({ groupName: '前天', chats: dayBeforeYesterdayChats })
  }

  const olderDays = [...olderByDay.keys()].sort((a, b) => b - a)
  for (const dayStart of olderDays) {
    const dayChats = olderByDay.get(dayStart)!
    groups.push({
      groupName: formatDateGroupLabel(new Date(dayStart)),
      chats: dayChats,
    })
  }

  if (unknownChats.length > 0) {
    groups.push({ groupName: '未知日期', chats: unknownChats })
  }

  return groups
}

/**
 * 两层分组：先按工作空间，再按时间。
 * 排序只按组内最新会话时间，不把「当前」强行置顶：
 * 点开 B 的历史会标记 B 为当前，但侧栏位置保持按活跃度，避免一点历史整组飞到最上面。
 */
function groupChatsByWorkspaceThenDate(
  chats: RecentChat[],
  currentCwd?: string,
): WorkspaceGroup[] {
  const currentKey = normalizeCwdKey(currentCwd).toLowerCase()
  const byWs = new Map<string, RecentChat[]>()

  for (const chat of chats) {
    const key = normalizeCwdKey(chat.cwd)
    const list = byWs.get(key)
    if (list) list.push(chat)
    else byWs.set(key, [chat])
  }

  const groups: WorkspaceGroup[] = []
  for (const [cwdKey, wsChats] of byWs) {
    const fullPath = cwdKey
    const isCurrent =
      currentKey.length > 0 &&
      cwdKey.toLowerCase() === currentKey &&
      cwdKey !== '(未知工作空间)'
    const baseName = workspaceDisplayName(cwdKey)
    groups.push({
      cwdKey,
      fullPath,
      isCurrent,
      label: isCurrent ? `${baseName} · 当前` : baseName,
      dateGroups: groupChatsByDate(wsChats),
    })
  }

  // 仅按最近活跃时间排序；isCurrent 只影响标签/样式，不改变位置
  groups.sort((a, b) => {
    const aTime = a.dateGroups[0]?.chats[0]
      ? new Date(a.dateGroups[0].chats[0].rawTimestamp || 0).getTime()
      : 0
    const bTime = b.dateGroups[0]?.chats[0]
      ? new Date(b.dateGroups[0].chats[0].rawTimestamp || 0).getTime()
      : 0
    return bTime - aTime
  })

  return groups
}

/** 更多菜单预估高度（重命名 + 删除两项） */
const MENU_ESTIMATED_HEIGHT = 80

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

/** 工作空间文件夹：展开 / 折叠两套 path，避免只靠旋转区分 */
function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`sidebar-folder-icon${open ? ' open' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {open ? (
        // 打开的文件夹
        <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        // 合上的文件夹
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  )
}

function ChatBubbleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  onNewChat,
  onOpenSettings,
  recentChats,
  activeChatId,
  currentWorkspaceCwd,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [menuOpenChatId, setMenuOpenChatId] = useState<string | null>(null)
  const [menuPlacement, setMenuPlacement] = useState<'above' | 'below'>('below')
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<RecentChat | null>(null)
  const [renameChat, setRenameChat] = useState<RecentChat | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  /** 用户手动折叠状态：key = cwdKey，true = 已折叠。未记录时默认：当前展开、其它折叠 */
  const [wsCollapsed, setWsCollapsed] = useState<Record<string, boolean>>({})

  // 点击外部收起更多菜单
  useEffect(() => {
    const handleWindowClick = () => setMenuOpenChatId(null)
    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [])

  // 搜索弹层：Esc 关闭；打开时聚焦输入框
  useEffect(() => {
    if (!searchOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    // 等弹层挂载后再聚焦
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [searchOpen])

  const openSearch = () => {
    setSearchQuery('')
    setSearchOpen(true)
    setMenuOpenChatId(null)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
  }

  const openMoreMenu = (chatId: string, isOpen: boolean, anchor: HTMLElement) => {
    if (isOpen) {
      setMenuOpenChatId(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const listEl = anchor.closest('.sidebar-recent-list')
    const bounds = listEl?.getBoundingClientRect()
    const spaceBelow = (bounds?.bottom ?? window.innerHeight) - rect.bottom
    const spaceAbove = rect.top - (bounds?.top ?? 0)
    const placeAbove =
      spaceBelow < MENU_ESTIMATED_HEIGHT + 8 && spaceAbove > spaceBelow
    setMenuPlacement(placeAbove ? 'above' : 'below')
    setMenuOpenChatId(chatId)
  }

  // 侧栏：工作空间 → 时间 两层分组（搜索只在弹层内）
  const workspaceGroups = useMemo(
    () => groupChatsByWorkspaceThenDate(recentChats, currentWorkspaceCwd),
    [recentChats, currentWorkspaceCwd],
  )

  const isWorkspaceCollapsed = useCallback(
    (ws: WorkspaceGroup): boolean => {
      if (Object.prototype.hasOwnProperty.call(wsCollapsed, ws.cwdKey)) {
        return wsCollapsed[ws.cwdKey]
      }
      // 默认：当前工作空间展开，其余折叠
      return !ws.isCurrent
    },
    [wsCollapsed],
  )

  const toggleWorkspace = (ws: WorkspaceGroup) => {
    const next = !isWorkspaceCollapsed(ws)
    setWsCollapsed((prev) => ({ ...prev, [ws.cwdKey]: next }))
  }

  const listRef = useRef<HTMLDivElement>(null)
  const activeChatRef = useRef<HTMLButtonElement>(null)
  /**
   * 仅在「需要把激活项滚进视口」时置 true：
   * - activeChatId 变化（点选 / 恢复会话）
   * - currentWorkspaceCwd 变化（跨工作区后分组置顶，布局大变）
   * 普通列表刷新（改标题等）不置位，避免把用户手动滚走的位置拽回来。
   */
  const needAlignActiveRef = useRef(false)
  const prevActiveIdRef = useRef(activeChatId)
  const prevCwdRef = useRef(currentWorkspaceCwd)

  if (prevActiveIdRef.current !== activeChatId) {
    prevActiveIdRef.current = activeChatId
    needAlignActiveRef.current = true
  }
  if (prevCwdRef.current !== currentWorkspaceCwd) {
    prevCwdRef.current = currentWorkspaceCwd
    needAlignActiveRef.current = true
  }

  // 激活会话所在工作空间必须展开，否则 active 节点未挂载，无法定位
  useLayoutEffect(() => {
    const chat = recentChats.find((c) => c.id === activeChatId)
    if (!chat) return
    const key = normalizeCwdKey(chat.cwd)
    setWsCollapsed((prev) => {
      // false = 已强制展开；勿重复 set 以免多余 render
      if (prev[key] === false) return prev
      return { ...prev, [key]: false }
    })
  }, [activeChatId, recentChats])

  // 布局提交后：只在侧栏列表容器内对齐激活项（可重试到 DOM 就绪）
  useLayoutEffect(() => {
    if (!needAlignActiveRef.current) return
    if (!activeChatId) return

    const chat = recentChats.find((c) => c.id === activeChatId)
    if (chat) {
      const key = normalizeCwdKey(chat.cwd)
      const ws = workspaceGroups.find((g) => g.cwdKey === key)
      if (ws && isWorkspaceCollapsed(ws)) {
        // 展开尚未反映到 DOM，等下一次 layout
        return
      }
    }

    const list = listRef.current
    const item = activeChatRef.current
    if (!list || !item) {
      // 节点还没挂上（刚展开），保留 needAlign，依赖更新后再试
      return
    }

    scrollChildIntoContainer(list, item)
    needAlignActiveRef.current = false
  }, [
    activeChatId,
    isWorkspaceCollapsed,
    recentChats,
    workspaceGroups,
    wsCollapsed,
  ])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return recentChats
    return recentChats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.cwd || '').toLowerCase().includes(q),
    )
  }, [recentChats, searchQuery])

  const handlePickSearchResult = (chat: RecentChat) => {
    closeSearch()
    onSelectChat(chat.id, chat.cwd)
  }

  const searchPanel = searchOpen ? (
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
          {searchResults.length === 0 ? (
            <div className="search-empty">
              {searchQuery.trim() ? '没有匹配的会话' : '暂无会话记录'}
            </div>
          ) : (
            <ul className="search-result-list">
              {searchResults.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    className={`search-result-item ${chat.id === activeChatId ? 'active' : ''
                      }`}
                    onClick={() => handlePickSearchResult(chat)}
                  >
                    <span className="search-result-icon" aria-hidden>
                      <ChatBubbleIcon />
                    </span>
                    <span className="search-result-main">
                      <span className="search-result-title" title={chat.title}>
                        {chat.title}
                      </span>
                      {chat.cwd ? (
                        <span
                          className="search-result-cwd"
                          title={chat.cwd}
                        >
                          {workspaceDisplayName(chat.cwd)}
                        </span>
                      ) : null}
                    </span>
                    <span className="search-result-time">
                      {formatSearchTimeLabel(chat)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  ) : null

  if (collapsed) {
    return (
      <>
        <aside className="sidebar sidebar-collapsed">
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
            title="搜索会话"
            onClick={openSearch}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className="sidebar-icon-btn new-chat-mini"
            title="新建会话"
            onClick={onNewChat}
          >
            +
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
        {searchPanel}
      </>
    )
  }

  return (
    <>
      <aside className="sidebar">
        {/* 顶栏品牌 & 搜索 / 收起 */}
        <div className="sidebar-header">
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          </div>
        </div>

        {/* 新建会话按钮 */}
        <div className="sidebar-new-chat-wrapper">
          <button type="button" className="btn-new-chat" onClick={onNewChat}>
            <span className="plus-icon">+</span>
            <span>New chat</span>
          </button>
        </div>

        {/* 工作空间 → 时间 两层分组的历史列表（原生滚动条：滑块按内容比例） */}
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
                  {ws.dateGroups.map((group) => (
                    <div key={`${ws.cwdKey}::${group.groupName}`} className="sidebar-group">
                      <div className="sidebar-group-title">{group.groupName}</div>
                      {group.chats.map((chat) => {
                        const isActive = chat.id === activeChatId
                        const isMenuOpen = menuOpenChatId === chat.id
                        return (
                          <div
                            key={chat.id}
                            className={`recent-item-container ${isActive ? 'active' : ''}`}
                          >
                            <button
                              type="button"
                              ref={isActive ? activeChatRef : undefined}
                              className="recent-item"
                              onClick={() => onSelectChat(chat.id, chat.cwd)}
                            >
                              <span className="recent-title" title={chat.title}>
                                {chat.title}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`recent-more-btn ${isMenuOpen ? 'open' : ''}`}
                              title="更多操作"
                              onClick={(e) => {
                                e.stopPropagation()
                                openMoreMenu(chat.id, isMenuOpen, e.currentTarget)
                              }}
                            >
                              ⋮
                            </button>

                            {isMenuOpen && (
                              <div
                                className={`recent-menu place-${menuPlacement}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="recent-menu-item"
                                  onClick={() => {
                                    setMenuOpenChatId(null)
                                    setRenameChat(chat)
                                    setRenameInput(chat.title)
                                    setRenameError(null)
                                  }}
                                >
                                  ✎ 重命名
                                </button>
                                <button
                                  type="button"
                                  className="recent-menu-item danger"
                                  onClick={() => {
                                    setMenuOpenChatId(null)
                                    setConfirmDeleteChat(chat)
                                  }}
                                >
                                  🗑 删除对话
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </CollapsibleWorkspaceBody>
              </div>
            )
          })}
        </div>

        {/* 底部账户与设置 */}
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

        {/* 二次确认删除弹窗 */}
        {confirmDeleteChat && (
          <div
            className="modal-backdrop"
            onClick={() => setConfirmDeleteChat(null)}
          >
            <div
              className="modal-card confirm-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>确认删除对话？</h2>
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setConfirmDeleteChat(null)}
                >
                  ✕
                </button>
              </div>
              <p className="confirm-modal-text">
                确定要删除「<strong>{confirmDeleteChat.title}</strong>」吗？删除后此对话记录将无法恢复。
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmDeleteChat(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    const targetId = confirmDeleteChat.id
                    const targetCwd = confirmDeleteChat.cwd
                    setConfirmDeleteChat(null)
                    onDeleteChat(targetId, targetCwd)
                  }}
                >
                  确定删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 重命名会话弹窗 */}
        {renameChat && (
          <div
            className="modal-backdrop"
            onClick={() => {
              if (!renaming) {
                setRenameChat(null)
                setRenameError(null)
              }
            }}
          >
            <div
              className="modal-card confirm-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>重命名对话</h2>
                <button
                  type="button"
                  className="close-btn"
                  disabled={renaming}
                  onClick={() => {
                    setRenameChat(null)
                    setRenameError(null)
                  }}
                >
                  ✕
                </button>
              </div>
              <label className="settings-label" htmlFor="rename-session-input">
                对话标题
              </label>
              <input
                id="rename-session-input"
                type="text"
                className="settings-input rename-input"
                value={renameInput}
                maxLength={120}
                autoFocus
                disabled={renaming}
                placeholder="输入新标题"
                onChange={(e) => {
                  setRenameInput(e.target.value)
                  setRenameError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void (async () => {
                      const next = renameInput.trim()
                      if (!next) {
                        setRenameError('标题不能为空')
                        return
                      }
                      if (next === renameChat.title.trim()) {
                        setRenameChat(null)
                        return
                      }
                      setRenaming(true)
                      setRenameError(null)
                      try {
                        await onRenameChat(renameChat.id, next, renameChat.cwd)
                        setRenameChat(null)
                      } catch (err) {
                        setRenameError(String(err))
                      } finally {
                        setRenaming(false)
                      }
                    })()
                  }
                }}
              />
              {renameError && <p className="rename-error">{renameError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={renaming}
                  onClick={() => {
                    setRenameChat(null)
                    setRenameError(null)
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={renaming || !renameInput.trim()}
                  onClick={() => {
                    void (async () => {
                      const next = renameInput.trim()
                      if (!next) {
                        setRenameError('标题不能为空')
                        return
                      }
                      if (next === renameChat.title.trim()) {
                        setRenameChat(null)
                        return
                      }
                      setRenaming(true)
                      setRenameError(null)
                      try {
                        await onRenameChat(renameChat.id, next, renameChat.cwd)
                        setRenameChat(null)
                      } catch (err) {
                        setRenameError(String(err))
                      } finally {
                        setRenaming(false)
                      }
                    })()
                  }}
                >
                  {renaming ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
      {searchPanel}
    </>
  )
}
