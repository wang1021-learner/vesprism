import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage, PermissionRequest } from '../../types'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  permission: PermissionRequest | null
  loadingSession?: boolean
  /** 切换会话时变化，用于强制滚到底部 */
  sessionKey?: string
  /** 正在流式生成（thought/assistant），用于减轻 Markdown 高亮等开销 */
  streaming?: boolean
}

function DownArrowIcon() {
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
      aria-hidden
    >
      <path d="M12 4v16m0 0-6-6m6 6 6-6" />
    </svg>
  )
}

export function MessageList({
  messages,
  permission,
  loadingSession,
  sessionKey,
  streaming = false,
}: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  /** 用户是否已主动向上离开底部（阅读历史时不抢滚动） */
  const userInteractedUp = useRef(false)
  /** 是否展示"跳到底部"悬浮按钮（配合 userInteractedUp 的可渲染状态） */
  const [showJumpButton, setShowJumpButton] = useState(false)
  /** 暂停贴底时的消息数基线，用于计算"新消息"数量 */
  const seenCountRef = useRef(0)
  const [newMessageCount, setNewMessageCount] = useState(0)

  /** 本帧是否已经排定了一次贴底，避免同一帧内 useLayoutEffect + ResizeObserver 重复触发 */
  const scrollScheduledRef = useRef(false)
  /** 有消息时才有 .messages-container，用于在空列表→首条消息时挂上 ResizeObserver */
  const hasMessages = messages.length > 0

  const scrollToEnd = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const scheduleScrollToEnd = useCallback(() => {
    if (scrollScheduledRef.current) return
    scrollScheduledRef.current = true
    requestAnimationFrame(() => {
      scrollScheduledRef.current = false
      scrollToEnd()
    })
  }, [scrollToEnd])

  const pauseAutoScroll = useCallback(() => {
    if (!userInteractedUp.current) {
      seenCountRef.current = messages.length
    }
    userInteractedUp.current = true
    setShowJumpButton(true)
  }, [messages.length])

  const resumeAutoScroll = useCallback(() => {
    userInteractedUp.current = false
    setShowJumpButton(false)
    setNewMessageCount(0)
  }, [])

  // 容器尺寸变化（Markdown 高亮、代码块撑开、流式增高）时按需贴底
  // hasMessages：从空状态切到有消息时需重新 observe（仅依赖 loadingSession 会漏挂）
  useEffect(() => {
    const containerEl = containerRef.current
    if (!containerEl || loadingSession) return

    const observer = new ResizeObserver(() => {
      if (!userInteractedUp.current) {
        scheduleScrollToEnd()
      }
    })

    observer.observe(containerEl)
    return () => observer.disconnect()
  }, [loadingSession, hasMessages, scheduleScrollToEnd])

  // 视口滚动：根据与底部距离恢复/暂停贴底
  const onViewportScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (gap < 30) {
      resumeAutoScroll()
    } else if (gap > 100) {
      pauseAutoScroll()
    }
  }, [pauseAutoScroll, resumeAutoScroll])

  // 向上滚轮：立刻切断贴底（不等 scroll 事件）
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      pauseAutoScroll()
    }
  }, [pauseAutoScroll])

  // 切会话 / 历史加载完成：重置并贴底
  useEffect(() => {
    userInteractedUp.current = false
    setShowJumpButton(false)
    setNewMessageCount(0)
    if (!loadingSession) {
      scrollToEnd()
    }
  }, [sessionKey, loadingSession, scrollToEnd])

  // 暂停贴底期间统计新新增的消息数量
  useEffect(() => {
    if (!showJumpButton) return
    const delta = messages.length - seenCountRef.current
    setNewMessageCount(delta > 0 ? delta : 0)
  }, [messages.length, showJumpButton])

  // 消息数据更新且未上滑：绘制前贴底
  useLayoutEffect(() => {
    if (loadingSession || userInteractedUp.current) return
    scheduleScrollToEnd()
  }, [messages, permission, loadingSession, scheduleScrollToEnd])

  if (loadingSession) {
    return (
      <div className="chat-viewport empty-state">
        <div className="empty-content loading-session-state">
          <div className="spinner-icon">✦</div>
          <p className="loading-text">加载中…</p>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="chat-viewport empty-state">
        <div className="empty-content">
          <div className="empty-icon">✦</div>
          <h2>What can I help with today?</h2>
          <p>在下方输入消息即可开始。</p>
        </div>
      </div>
    )
  }

  const lastId = messages[messages.length - 1]?.id

  return (
    <div className="chat-viewport-wrapper">
      <div
        className="chat-viewport"
        ref={viewportRef}
        onScroll={onViewportScroll}
        onWheel={onWheel}
      >
        <div className="messages-container" ref={containerRef}>
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              streaming={streaming && m.id === lastId}
            />
          ))}
        </div>
      </div>

      {showJumpButton && (
        <button
          type="button"
          className="jump-to-bottom-btn"
          onClick={() => {
            resumeAutoScroll()
            scheduleScrollToEnd()
          }}
          title={newMessageCount > 0 ? `${newMessageCount} 条新消息，点击跳到底部` : '跳到底部'}
        >
          <span className="jump-to-bottom-icon">
            <DownArrowIcon />
          </span>
          {newMessageCount > 0 && (
            <span className="jump-to-bottom-badge">{newMessageCount > 9 ? '9+' : newMessageCount}</span>
          )}
        </button>
      )}
    </div>
  )
}
