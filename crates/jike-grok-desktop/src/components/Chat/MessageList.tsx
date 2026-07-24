import { useCallback, useEffect, useRef } from 'react'
import type { ChatMessage, PermissionRequest } from '../../types'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  permission: PermissionRequest | null
  loadingSession?: boolean
  /** 切换会话时变化，用于强制滚到底部 */
  sessionKey?: string
}

export function MessageList({
  messages,
  permission,
  loadingSession,
  sessionKey,
}: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevLoading = useRef(!!loadingSession)
  /** 历史回放/切会话后短时间内强制贴底，避免卡在开头 */
  const pinBottomUntil = useRef(0)

  const scrollToEnd = useCallback((smooth = false) => {
    const el = viewportRef.current
    if (el) {
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        // instant：历史回放瞬间塞很多条时必须立刻贴底
        el.scrollTop = el.scrollHeight
      }
    }
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    })
  }, [])

  // 切换会话或进入加载：进入「强制贴底」窗口
  useEffect(() => {
    pinBottomUntil.current = Date.now() + 2500
    if (!loadingSession) {
      // 下一帧布局完成后再滚
      requestAnimationFrame(() => scrollToEnd(false))
    }
  }, [sessionKey, loadingSession, scrollToEnd])

  // 消息变化时滚动
  useEffect(() => {
    if (loadingSession) return

    const pinning = Date.now() < pinBottomUntil.current
    const el = viewportRef.current
    // 贴底窗口内，或用户本来就在底部附近 → 跟随到底
    let nearBottom = true
    if (el) {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      nearBottom = gap < 120
    }

    if (pinning || nearBottom) {
      // 回放/切会话用 instant；日常流式可用 smooth
      scrollToEnd(pinning ? false : true)
    }
  }, [messages, permission, loadingSession, scrollToEnd])

  // 加载结束瞬间：回放事件往往在 load_session 返回之后才到，多补几次 instant 贴底
  useEffect(() => {
    const wasLoading = prevLoading.current
    prevLoading.current = !!loadingSession
    if (!wasLoading || loadingSession) return

    pinBottomUntil.current = Date.now() + 2500
    const timers = [0, 50, 150, 400, 800, 1500].map((ms) =>
      window.setTimeout(() => scrollToEnd(false), ms),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [loadingSession, scrollToEnd])

  if (loadingSession) {
    return (
      <div className="chat-viewport empty-state">
        <div className="empty-content loading-session-state">
          <div className="spinner-icon">✦</div>
          <p className="loading-text">正在加载历史会话...</p>
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
          <p>启动会话后输入消息，支持代码生成、问答与深度推演。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-viewport" ref={viewportRef}>
      <div className="messages-container">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
        <div ref={bottomRef} aria-hidden />
      </div>
    </div>
  )
}
