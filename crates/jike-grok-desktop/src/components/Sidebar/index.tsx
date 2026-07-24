import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecentChat } from '../../types'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  recentChats: RecentChat[]
  activeChatId: string
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  /** 重命名会话标题（持久化）；返回 Promise 供弹窗显示错误 */
  onRenameChat: (id: string, title: string) => Promise<void>
}

type GroupedChats = {
  groupName: string
  chats: RecentChat[]
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

function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M8 10h8M8 14h5"
        strokeLinecap="round"
      />
      <path
        d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.4-.2-3.4-.7L4 21l1.3-3.6A8.4 8.4 0 0 1 3.5 12 8.5 8.5 0 1 1 21 12z"
        strokeLinejoin="round"
      />
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

  // 侧栏历史列表始终展示全部（搜索只在弹层内）
  const groupedChats = useMemo(() => groupChatsByDate(recentChats), [recentChats])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return recentChats
    return recentChats.filter((c) => c.title.toLowerCase().includes(q))
  }, [recentChats, searchQuery])

  const handlePickSearchResult = (id: string) => {
    closeSearch()
    onSelectChat(id)
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
                    className={`search-result-item ${
                      chat.id === activeChatId ? 'active' : ''
                    }`}
                    onClick={() => handlePickSearchResult(chat.id)}
                  >
                    <span className="search-result-icon" aria-hidden>
                      <ChatBubbleIcon />
                    </span>
                    <span className="search-result-title" title={chat.title}>
                      {chat.title}
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
            className="sidebar-icon-btn"
            title="展开边栏"
            onClick={onToggleCollapse}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
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
          <div className="sidebar-brand">
            <span className="brand-logo">✦</span>
            <span className="brand-name">AIAcong Agent</span>
          </div>
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

        {/* 按日期分组的历史列表 */}
        <div className="sidebar-recent-list">
          {groupedChats.map((group) => (
            <div key={group.groupName} className="sidebar-group">
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
                      className="recent-item"
                      onClick={() => onSelectChat(chat.id)}
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
                    setConfirmDeleteChat(null)
                    onDeleteChat(targetId)
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
                        await onRenameChat(renameChat.id, next)
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
                        await onRenameChat(renameChat.id, next)
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
