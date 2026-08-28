import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { formatEngineError } from '../../lib/errorMessage'
import {
  $activeChatId,
  $chats,
  $commandPaletteOpen,
  $rightPanelOpen,
  $sidebarAutoCollapsed,
  $sidebarCollapsed,
  openFeedback,
  openSessionIntent,
  openSettings,
  isScratchCwd,
  type ChatSummary,
} from '../../store'
import { searchSessions } from '../../bridge'
import { startAccountLogin } from '../../lib/accountAuth'
import { openChatFind, openSessionInsight, openSessionSchedule, requestRecap, shareCurrentSession } from '../../lib/engineSlash'
import { openChatTab } from '../../lib/openChatTab'

type SearchHit = ChatSummary & { snippet?: string }

type QuickCommand = {
  id: string
  title: string
  subtitle: string
  action: () => void
}

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

function normalizeCwdKey(cwd: string | undefined): string {
  return (cwd || '').trim().replace(/\\/g, '/').replace(/\/+$/, '') || '(未知工作空间)'
}

function workspaceDisplayName(cwd: string): string {
  const key = normalizeCwdKey(cwd)
  if (key === '(未知工作空间)') return key
  if (isScratchCwd(cwd)) return '闲聊'
  const parts = key.split('/').filter(Boolean)
  return parts[parts.length - 1] || key
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

function CommandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

export function CommandPalette() {
  const open = useStore($commandPaletteOpen)
  const activeChatId = useStore($activeChatId)
  const chats = useStore($chats)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const searchGenRef = useRef(0)

  // 全局 ⌘K / Ctrl+K 监听
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        $commandPaletteOpen.set(!$commandPaletteOpen.get())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 弹层打开时自动聚焦并清空输入
  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setError('')
      setLoading(false)
      setBootstrapping(false)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') $commandPaletteOpen.set(false)
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open])

  // FTS 搜索逻辑 (debounce 250ms)
  useEffect(() => {
    const q = query.trim()
    if (!open || !q || q.startsWith('>')) {
      setHits([])
      setLoading(false)
      setBootstrapping(false)
      setError('')
      return
    }
    const gen = ++searchGenRef.current
    setLoading(true)
    setError('')
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await searchSessions(q, null, 50)
          if (gen !== searchGenRef.current) return
          setBootstrapping(Boolean(res.bootstrapping))
          setHits(
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
          setHits([])
          setError(formatEngineError(e))
        } finally {
          if (gen === searchGenRef.current) setLoading(false)
        }
      })()
    }, 250)
    return () => window.clearTimeout(t)
  }, [query, open])

  useEffect(() => {
    setActive(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active, query, open])

  if (!open) return null

  const isCommandMode = query.trim().startsWith('>')
  const commandFilter = query.trim().slice(1).trim().toLowerCase()

  const quickCommands: QuickCommand[] = [
    {
      id: 'cmd-new-chat',
      title: '新建会话',
      subtitle: '创建一个新的对话 Tab (Ctrl+N)',
      action: () => {
        window.dispatchEvent(new CustomEvent('jike:new-chat'))
      },
    },
    {
      id: 'cmd-toggle-sidebar',
      title: '展开 / 折叠侧栏',
      subtitle: '切换历史会话侧栏显示状态',
      action: () => {
        $sidebarCollapsed.set(!$sidebarCollapsed.get())
        $sidebarAutoCollapsed.set(false)
      },
    },
    {
      id: 'cmd-toggle-rightpanel',
      title: '开关右侧面板',
      subtitle: '打开或关闭文件树/源码预览面板',
      action: () => {
        $rightPanelOpen.set(!$rightPanelOpen.get())
      },
    },
    {
      id: 'cmd-settings',
      title: '打开设置',
      subtitle: '模型、技能、工具、MCP、记忆和插件',
      action: () => {
        openSettings()
      },
    },
    {
      id: 'cmd-skills',
      title: '技能',
      subtitle: '提示包：浏览、启停（写入本机配置）',
      action: () => {
        openSettings('skills')
      },
    },
    {
      id: 'cmd-tools',
      title: '工具',
      subtitle: '模型会调的能力；停用只作用于本工作区对话',
      action: () => {
        openSettings('tools')
      },
    },
    {
      id: 'cmd-mcp',
      title: 'MCP',
      subtitle: '外接服务器连接；调用列表在工具页',
      action: () => {
        openSettings('mcp')
      },
    },
    {
      id: 'cmd-insight',
      title: '上下文与用量',
      subtitle: '压缩、拆分上下文、本会话费用',
      action: () => {
        openSessionInsight()
      },
    },
    {
      id: 'cmd-memory',
      title: '记忆',
      subtitle: '全局 / 本仓库笔记，不是聊天记录',
      action: () => {
        openSettings('memory')
      },
    },
    {
      id: 'cmd-plugins',
      title: '插件',
      subtitle: '一整箱技能和 MCP；启停写本机配置',
      action: () => {
        openSettings('plugins')
      },
    },
    {
      id: 'cmd-workflows',
      title: '自动化任务',
      subtitle: '浏览和运行工作流（/workflows）',
      action: () => {
        void openChatTab({ title: '自动化任务', utilityKind: 'workflows' })
      },
    },
    {
      id: 'cmd-schedule',
      title: '定时任务',
      subtitle: '按间隔反复执行同一条指令（/loop）',
      action: () => {
        openSessionSchedule()
      },
    },
    {
      id: 'cmd-goal',
      title: '设目标',
      subtitle: '长程规划并执行，直到完成或你停掉',
      action: () => {
        openSessionIntent('goal')
      },
    },
    {
      id: 'cmd-deep-research',
      title: '深度研究',
      subtitle: '多路检索并交叉核对，写出带引用的报告',
      action: () => {
        openSessionIntent('research')
      },
    },
    {
      id: 'cmd-login',
      title: '登录账号',
      subtitle: '打开浏览器完成官方授权',
      action: () => {
        openSettings('general')
        void startAccountLogin()
      },
    },
    {
      id: 'cmd-feedback',
      title: '发送反馈',
      subtitle: '对本会话的意见发给官方反馈通道',
      action: () => {
        openFeedback()
      },
    },
    {
      id: 'cmd-share',
      title: '分享本会话',
      subtitle: '生成链接并复制；账号未开通时引擎会拒绝',
      action: () => {
        void shareCurrentSession()
      },
    },
    {
      id: 'cmd-computer',
      title: '电脑操作',
      subtitle: '截屏、点击、打字。默认关，到设置里授权',
      action: () => {
        openSettings('security')
      },
    },
    {
      id: 'cmd-recap',
      title: '回顾',
      subtitle: '这场对话进行到哪（/recap）',
      action: () => {
        void requestRecap()
      },
    },
    {
      id: 'cmd-find',
      title: '在对话里找',
      subtitle: '搜索当前会话消息（Ctrl+F）',
      action: () => {
        openChatFind()
      },
    },
  ].filter((c) => !commandFilter || c.title.toLowerCase().includes(commandFilter) || c.subtitle.toLowerCase().includes(commandFilter))

  const recentChats = chats.slice(0, 8)
  const chatRows: SearchHit[] = query.trim() ? hits : recentChats
  const rowCount = isCommandMode ? quickCommands.length : chatRows.length
  const safeActive = rowCount === 0 ? 0 : Math.min(active, rowCount - 1)

  const handlePickChat = (chat: ChatSummary) => {
    $commandPaletteOpen.set(false)
    window.dispatchEvent(new CustomEvent('jike:open-chat', { detail: { id: chat.id, cwd: chat.cwd } }))
  }

  const handleRunCommand = (cmd: QuickCommand) => {
    $commandPaletteOpen.set(false)
    cmd.action()
  }

  const runActive = () => {
    if (isCommandMode) {
      const cmd = quickCommands[safeActive]
      if (cmd) handleRunCommand(cmd)
      return
    }
    const chat = chatRows[safeActive]
    if (chat) handlePickChat(chat)
  }

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (rowCount === 0) return
      setActive((i) => (i + 1) % rowCount)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (rowCount === 0) return
      setActive((i) => (i - 1 + rowCount) % rowCount)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      runActive()
    }
  }

  return (
    <div className="command-palette-backdrop" onClick={() => $commandPaletteOpen.set(false)}>
      <div
        className="command-palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="全局指令中心"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="command-palette-header">
          <span className="command-palette-icon" aria-hidden>
            {isCommandMode ? <CommandIcon /> : <SearchIcon />}
          </span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="搜索会话…（输入 > 运行指令）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            aria-activedescendant={rowCount ? `palette-row-${safeActive}` : undefined}
          />
          <span className="command-palette-badge">⌘K</span>
          <button
            type="button"
            className="command-palette-close"
            title="关闭 (Esc)"
            onClick={() => $commandPaletteOpen.set(false)}
          >
            ✕
          </button>
        </div>

        <div className="command-palette-body">
          {isCommandMode ? (
            <div className="command-palette-section">
              <div className="command-palette-section-title">系统指令</div>
              {quickCommands.length === 0 ? (
                <div className="search-empty">没有匹配的指令</div>
              ) : (
                <ul className="search-result-list">
                  {quickCommands.map((cmd, i) => (
                    <li key={cmd.id}>
                      <button
                        id={`palette-row-${i}`}
                        type="button"
                        ref={i === safeActive ? activeRef : undefined}
                        className={`search-result-item${i === safeActive ? ' is-kbd' : ''}`}
                        onClick={() => handleRunCommand(cmd)}
                      >
                        <span className="search-result-icon" aria-hidden>
                          <CommandIcon />
                        </span>
                        <span className="search-result-main">
                          <span className="search-result-title">{cmd.title}</span>
                          <span className="search-result-cwd">{cmd.subtitle}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : error ? (
            <div className="search-empty">搜索失败：{error}</div>
          ) : loading ? (
            <div className="search-empty">搜索中…</div>
          ) : query.trim() && hits.length === 0 ? (
            <div className="search-empty">
              {bootstrapping ? '索引建立中，请稍后再试…' : '没有匹配的会话'}
            </div>
          ) : !query.trim() ? (
            <div className="command-palette-initial">
              <div className="command-palette-hint-row">
                <span>提示：输入 <code>&gt;</code> 开启系统指令模式</span>
              </div>
              {chats.length > 0 && (
                <div className="command-palette-section">
                  <div className="command-palette-section-title">最近会话</div>
                  <ul className="search-result-list">
                    {recentChats.map((chat, i) => (
                      <li key={chat.id}>
                        <button
                          id={`palette-row-${i}`}
                          type="button"
                          ref={i === safeActive ? activeRef : undefined}
                          className={`search-result-item${chat.id === activeChatId ? ' active' : ''}${i === safeActive ? ' is-kbd' : ''}`}
                          onClick={() => handlePickChat(chat)}
                          title={chat.title}
                        >
                          <span className="search-result-icon" aria-hidden>
                            <ChatBubbleIcon />
                          </span>
                          <span className="search-result-main">
                            <span className="search-result-title">
                              {chat.title || '新对话'}
                            </span>
                            <span className="search-result-cwd" title={chat.cwd}>
                              {workspaceDisplayName(chat.cwd)}
                            </span>
                          </span>
                          <span className="search-result-time">
                            {formatSearchTimeLabel(chat.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <ul className="search-result-list">
              {hits.map((chat, i) => (
                <li key={chat.id}>
                  <button
                    id={`palette-row-${i}`}
                    type="button"
                    ref={i === safeActive ? activeRef : undefined}
                    className={`search-result-item${chat.id === activeChatId ? ' active' : ''}${i === safeActive ? ' is-kbd' : ''}`}
                    onClick={() => handlePickChat(chat)}
                    title={chat.title}
                  >
                    <span className="search-result-icon" aria-hidden>
                      <ChatBubbleIcon />
                    </span>
                    <span className="search-result-main">
                      <span className="search-result-title">
                        {chat.title || '新对话'}
                      </span>
                      {chat.snippet ? (
                        <span className="search-result-cwd" title={chat.snippet}>
                          {chat.snippet}
                        </span>
                      ) : chat.cwd ? (
                        <span className="search-result-cwd" title={chat.cwd}>
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
  )
}
