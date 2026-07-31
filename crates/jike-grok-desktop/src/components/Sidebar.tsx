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
  $activeChatId,
  $activeSessionId,
  $chats,
  $composerInput,
  $contextUsedTokens,
  $defaultModelId,
  $engineStatus,
  $error,
  $messages,
  $models,
  $permission,
  $reasoningEffort,
  $sessionPhase,
  $settingsOpen,
  $sidebarCollapsed,
  $workspaceCwd,
  type ChatSummary,
} from '../store'
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  loadSession,
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
      {open ? (
        <path
          d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
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
  const chats = useStore($chats)
  const cwd = useStore($workspaceCwd)

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
    const w = workspace ?? $workspaceCwd.get()
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

  useEffect(() => {
    if (!cwd) return
    void refreshChats(cwd)
  }, [cwd, refreshChats])

  useEffect(() => {
    if (!menuOpenChatId) return
    const onDown = () => setMenuOpenChatId(null)
    window.addEventListener('click', onDown)
    return () => window.removeEventListener('click', onDown)
  }, [menuOpenChatId])

  const openSearch = () => {
    setSearchQuery('')
    setSearchHits([])
    setSearchError('')
    setSearchBootstrapping(false)
    setSearchOpen(true)
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
    const currentKey = normalizeCwdKey(cwd)
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
        isCurrent: key === currentKey,
        chats: sorted,
      })
    }
    groups.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return a.label.localeCompare(b.label, 'zh')
    })
    return groups
  }, [chats, cwd])

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

  const onSelectChat = async (id: string, sessionCwd?: string) => {
    if ($sessionPhase.get() === 'loading') return
    if (id === $activeSessionId.get() && $sessionPhase.get() === 'ready') {
      $activeChatId.set(id)
      setMenuOpenChatId(null)
      return
    }

    // 切走前缓存当前会话消息，回来时可跳过磁盘投影
    const prevId = $activeSessionId.get()
    if (prevId && prevId !== id) {
      const cur = $messages.get()
      if (cur.length > 0) cacheSessionMessages(prevId, cur)
    }

    $activeChatId.set(id)
    setMenuOpenChatId(null)
    const useCwd = (sessionCwd || cwd).trim() || cwd
    const gen = nextLoadGen()

    try {
      // 先清空 + loading，避免短暂仍显示上一会话（再从顶跳到底）
      $messages.set([])
      $sessionPhase.set('loading')
      $engineStatus.set('initializing')

      let messages = getCachedSessionMessages(id)
      if (!messages) {
        const raw = await getSessionMessages(id)
        if (gen !== currentLoadGen()) return
        messages = raw.map((m) => hydrateDisplayMessage(m))
        cacheSessionMessages(id, messages)
      } else if (gen !== currentLoadGen()) {
        return
      }

      hydrateFromSnapshot(messages)

      beginAttachRuntime()
      await loadSession(id, useCwd)
      if (gen !== currentLoadGen()) return
      finishAttachRuntime()
      $activeSessionId.set(id)
      // runtime 挂好后刷新缓存（含切走期间可能未写入的快照）
      cacheSessionMessages(id, $messages.get())
    } catch (e) {
      if (gen !== currentLoadGen()) return
      abortOpenSession()
      $engineStatus.set('idle')
      $error.set(String(e))
    }
  }

  const handlePickSearchResult = (chat: SearchHit) => {
    closeSearch()
    void onSelectChat(chat.id, chat.cwd)
  }

  const onNewChat = useCallback(async () => {
    // 加载历史 / 挂 runtime / 重启中不可再点
    const phase = $sessionPhase.get()
    if (phase === 'loading' || phase === 'restarting' || phase === 'booting') return
    if ($engineStatus.get() === 'generating') return

    setMenuOpenChatId(null)
    try {
      abortOpenSession()
      // 清空 UI（与旧版 resetConversationUi 一致）
      $messages.set([])
      $composerInput.set('')
      $contextUsedTokens.set(0)
      $permission.set(null)
      $error.set('')
      $activeChatId.set('')
      $activeSessionId.set('')
      $sessionPhase.set('restarting')
      $engineStatus.set('initializing')

      // 后端：丢弃当前会话；空会话不进历史；启新 session
      try {
        await restartSession(cwd)
      } catch {
        await startSession(cwd)
      }

      // 新会话对齐当前默认模型 / 推理档
      const modelId = $defaultModelId.get().trim()
      if (modelId) {
        const entry = $models.get().find((m) => m.id === modelId)
        const effort = entry?.supports_reasoning_effort
          ? entry.reasoning_effort || $reasoningEffort.get() || 'medium'
          : undefined
        try {
          await setCurrentModel(modelId, effort)
          if (effort) $reasoningEffort.set(effort)
        } catch (e) {
          console.warn('新会话同步模型失败', e)
        }
      }

      $sessionPhase.set('ready')
      $engineStatus.set('idle')
      await refreshChats()
    } catch (e) {
      $sessionPhase.set('ready')
      $engineStatus.set('idle')
      $error.set(String(e))
    }
  }, [cwd, refreshChats])

  // App 快捷键 Ctrl/Cmd+N
  useEffect(() => {
    const onNew = () => {
      void onNewChat()
    }
    window.addEventListener('jike:new-chat', onNew)
    return () => window.removeEventListener('jike:new-chat', onNew)
  }, [onNewChat])

  const handleDelete = async (chat: ChatSummary) => {
    setBusy(true)
    try {
      await deleteSession(chat.id, chat.cwd || cwd)
      invalidateSessionMessages(chat.id)
      if (chat.id === activeChatId) {
        $messages.set([])
        $activeChatId.set('')
        try {
          await restartSession(cwd)
        } catch {
          await startSession(cwd)
        }
      }
      setConfirmDelete(null)
      await refreshChats()
    } catch (e) {
      $error.set(String(e))
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

  const onToggleCollapse = () => {
    $sidebarCollapsed.set(!$sidebarCollapsed.get())
  }

  const onOpenSettings = () => {
    $settingsOpen.set(true)
  }

  if (collapsed) {
    return (
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
          onClick={() => {
            $sidebarCollapsed.set(false)
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
    )
  }

  return (
    <>
      <aside className="sidebar">
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
