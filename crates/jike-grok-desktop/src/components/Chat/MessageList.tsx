import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatMessage, ChatRole, PermissionRequest } from '../../types'
import { MessageItem } from './MessageItem'

const ITEM_GAP = 24
/** 流式贴底：最多每 N 帧读一次 scrollHeight，降低 layout 频率 */
const STREAM_SCROLL_EVERY_N = 2

function estimateMessageSize(role: ChatRole, textLen: number): number {
  switch (role) {
    case 'system':
      return 40 + ITEM_GAP
    case 'thought':
      return 52 + ITEM_GAP
    case 'tool':
      return 88 + ITEM_GAP
    case 'user':
      return Math.min(280, 56 + Math.ceil(textLen / 80) * 22) + ITEM_GAP
    case 'assistant':
    default:
      return Math.min(560, 64 + Math.ceil(textLen / 70) * 20) + ITEM_GAP
  }
}

interface MessageListProps {
  messages: ChatMessage[]
  permission: PermissionRequest | null
  loadingHistory?: boolean
  sessionKey?: string
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

/**
 * 虚拟化消息列表 + 测高缓存 + 按消息 id 计新气泡。
 * 贴底仍用 scrollTop/scrollHeight（不用 scrollToIndex 估高），流式降频读 layout。
 */
export function MessageList({
  messages,
  permission: _permission,
  loadingHistory = false,
  sessionKey,
  streaming = false,
}: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const userInteractedUp = useRef(false)
  const [showJumpButton, setShowJumpButton] = useState(false)
  /** 用户离开底部时已见过的最大消息 id */
  const seenMaxIdRef = useRef(0)
  /** 列表中最大 message id（id 单调递增，用末条维护） */
  const maxMessageIdRef = useRef(0)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const scrollScheduledRef = useRef(false)
  const lastScrollHeightRef = useRef(0)
  const heightCacheRef = useRef<Map<number, number>>(new Map())
  /** 流式贴底降频计数 */
  const streamScrollTickRef = useRef(0)

  const count = messages.length
  const lastMessage = count > 0 ? messages[count - 1] : undefined
  const lastMessageId = lastMessage?.id
  const lastMessageTextLength = lastMessage?.text?.length

  // 维护 max id（O(1)，替代多处 reduce）
  useEffect(() => {
    if (lastMessage) {
      maxMessageIdRef.current = Math.max(maxMessageIdRef.current, lastMessage.id)
    }
  }, [lastMessage, lastMessageId])

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => {
      const m = messages[index]
      if (!m) return 80 + ITEM_GAP
      const cached = heightCacheRef.current.get(m.id)
      if (cached != null && cached > 0) return cached
      return estimateMessageSize(m.role, m.text?.length ?? 0)
    },
    overscan: streaming ? 6 : 8,
    getItemKey: (index) => messages[index]?.id ?? index,
    measureElement: (el) => {
      const h = el.getBoundingClientRect().height
      const idx = Number(el.getAttribute('data-index'))
      const m = messages[idx]
      if (m && h > 0) {
        heightCacheRef.current.set(m.id, h)
      }
      return h
    },
  })

  const stickScrollToBottom = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    // 仍读 scrollHeight（贴底可靠）；调用方负责降频
    const sh = el.scrollHeight
    el.scrollTop = sh
    lastScrollHeightRef.current = sh
  }, [])

  const scheduleStickBottom = useCallback(() => {
    if (userInteractedUp.current) return
    if (scrollScheduledRef.current) return
    scrollScheduledRef.current = true
    // 与 setMessages 错开到下一帧，减轻同帧 Layout
    requestAnimationFrame(() => {
      scrollScheduledRef.current = false
      if (userInteractedUp.current) return
      stickScrollToBottom()
    })
  }, [stickScrollToBottom])

  const markSeenToMax = useCallback(() => {
    seenMaxIdRef.current = maxMessageIdRef.current
  }, [])

  const pauseAutoScroll = useCallback(() => {
    if (!userInteractedUp.current) {
      markSeenToMax()
    }
    userInteractedUp.current = true
    setShowJumpButton(true)
  }, [markSeenToMax])

  const resumeAutoScroll = useCallback(() => {
    userInteractedUp.current = false
    setShowJumpButton(false)
    setNewMessageCount(0)
    markSeenToMax()
    scheduleStickBottom()
  }, [scheduleStickBottom, markSeenToMax])

  const onViewportScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = streaming ? gap < 80 : gap < 48
    if (nearBottom) {
      if (userInteractedUp.current) {
        userInteractedUp.current = false
        setShowJumpButton(false)
        setNewMessageCount(0)
        markSeenToMax()
      }
    } else if (gap > 120) {
      pauseAutoScroll()
    }
  }, [pauseAutoScroll, streaming, markSeenToMax])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY < 0) pauseAutoScroll()
    },
    [pauseAutoScroll],
  )

  useEffect(() => {
    userInteractedUp.current = false
    setShowJumpButton(false)
    setNewMessageCount(0)
    seenMaxIdRef.current = 0
    maxMessageIdRef.current = lastMessage?.id ?? 0
    lastScrollHeightRef.current = 0
    streamScrollTickRef.current = 0
    heightCacheRef.current.clear()
    if (!loadingHistory && count > 0) {
      requestAnimationFrame(() => stickScrollToBottom())
    }
  }, [sessionKey, loadingHistory, stickScrollToBottom, count, lastMessage?.id])

  useEffect(() => {
    if (!showJumpButton) return
    const n = messages.filter((m) => m.id > seenMaxIdRef.current).length
    setNewMessageCount(n)
  }, [messages, showJumpButton, lastMessageId, count])

  // 非流式 / 跳底：下一帧 stick
  useLayoutEffect(() => {
    if (loadingHistory || userInteractedUp.current || count === 0) return
    if (streaming) return
    scheduleStickBottom()
  }, [count, lastMessageId, loadingHistory, scheduleStickBottom, streaming])

  // 流式：totalSize / 文本变长时降频读 scrollHeight，不用 scrollToIndex
  const totalSize = virtualizer.getTotalSize()
  useEffect(() => {
    if (loadingHistory || userInteractedUp.current || count === 0) return
    if (!streaming) {
      scheduleStickBottom()
      return
    }
    streamScrollTickRef.current += 1
    if (streamScrollTickRef.current % STREAM_SCROLL_EVERY_N !== 0) {
      return
    }
    const el = viewportRef.current
    if (!el) return
    const prev = lastScrollHeightRef.current
    const next = el.scrollHeight
    if (next > prev && prev > 0) {
      el.scrollTop += next - prev
    } else {
      el.scrollTop = next
    }
    lastScrollHeightRef.current = el.scrollHeight
  }, [
    totalSize,
    lastMessageTextLength,
    streaming,
    loadingHistory,
    scheduleStickBottom,
    count,
  ])

  if (loadingHistory) {
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
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="chat-viewport-wrapper">
      <div
        className="chat-viewport chat-viewport-virtual"
        ref={viewportRef}
        onScroll={onViewportScroll}
        onWheel={onWheel}
      >
        <div
          className="messages-container messages-container-virtual"
          style={{
            height: totalSize,
            position: 'relative',
            width: '90%',
            maxWidth: 768,
            margin: '0 auto',
          }}
        >
          {virtualItems.map((vi) => {
            const m = messages[vi.index]
            if (!m) return null
            const isLast = m.id === lastId
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="message-virtual-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  paddingBottom: vi.index < count - 1 ? ITEM_GAP : 0,
                  boxSizing: 'border-box',
                }}
              >
                <MessageItem message={m} streaming={Boolean(streaming && isLast)} />
              </div>
            )
          })}
        </div>
      </div>

      {showJumpButton && (
        <button
          type="button"
          className="jump-to-bottom-btn"
          onClick={() => resumeAutoScroll()}
          title={
            newMessageCount > 0
              ? `${newMessageCount} 条新消息，点击跳到底部`
              : '跳到底部'
          }
        >
          <span className="jump-to-bottom-icon">
            <DownArrowIcon />
          </span>
          {newMessageCount > 0 && (
            <span className="jump-to-bottom-badge">
              {newMessageCount > 9 ? '9+' : newMessageCount}
            </span>
          )}
        </button>
      )}
    </div>
  )
}
