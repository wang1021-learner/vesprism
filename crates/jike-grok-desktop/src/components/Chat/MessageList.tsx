import { useRef, useEffect, memo } from 'react'
import { useStore } from '@nanostores/react'
import type { ChatMessage, PermissionRequest } from '../../types'
import { $sessionPhase } from '../../store'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  streaming: boolean
  permission: PermissionRequest | null
}

export const MessageList = memo(function MessageList({
  messages,
  streaming,
}: MessageListProps) {
  const phase = useStore($sessionPhase)
  const loadingHistory = phase === 'loading'
  const bottomRef = useRef<HTMLDivElement>(null)
  /** 滚动落在 chat-viewport 上，与 CSS overflow 一致 */
  const viewportRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (loadingHistory) return
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loadingHistory])

  if (loadingHistory && messages.length === 0) {
    return (
      <div className="chat-viewport-wrapper">
        <div className="chat-viewport messages-empty loading-session-state">
          <div className="spinner-icon" aria-hidden>
            ✦
          </div>
          <p className="loading-text">加载会话中…</p>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="chat-viewport-wrapper">
        <div className="chat-viewport messages-empty">
          <div className="empty-content">
            <div className="empty-icon">✦</div>
            <h2>Grok Build</h2>
            <p>Ask anything or start working on your project.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-viewport-wrapper">
      <div className="chat-viewport" ref={viewportRef}>
        <div className="messages-container">
          {messages.map((msg, i) => (
            <MessageItem
              key={msg.id}
              message={msg}
              streaming={streaming && i === messages.length - 1}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
})
