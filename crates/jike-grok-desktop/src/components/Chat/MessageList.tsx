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
 * 虚拟化 history + 流式 live 尾条（普通 DOM）。
 *
 * 流式时只 virtualize `messages[0..n-2]`，末条固定在列表下方不参与 measure，
 * 避免 virtualizer 对增长中的气泡反复测高/diff。
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

  /** 流式：history 与 live 拆分；非流式：全部进虚拟列表。不 slice，避免每帧新数组。 */
  const useLiveTail = Boolean(streaming && count > 0)
  const historyCount = useLiveTail ? count - 1 : count
  const liveMessage = useLiveTail ? lastMessage : undefined

  // 维护 max id（O(1)，替代多处 reduce）
  useEffect(() => {
    if (lastMessage) {
      maxMessageIdRef.current = Math.max(maxMessageIdRef.current, lastMessage.id)
    }
  }, [lastMessage, lastMessageId])

  const virtualizer = useVirtualizer({
    count: historyCount,
    getScrollElement: () => viewportRef.current,
    // React 19：measureElement 在 commitAttachRef 里若用 flushSync 会报
    // "flushSync was called from inside a lifecycle method"，并可能导致测高
    // 失败、历史气泡叠层/只看见用户消息。关闭后改为异步 rerender。
    useFlushSync: false,
    estimateSize: (index) => {
      const m = messages[index]
      if (!m) return 80 + ITEM_GAP
      const cached = heightCacheRef.current.get(m.id)
      if (cached != null && cached > 0) return cached
      return estimateMessageSize(m.role, m.text?.length ?? 0)
    },
    overscan: streaming ? 4 : 8,
    getItemKey: (index) => messages[index]?.id ?? index,
    measureElement: (el) => {
      // 用 offsetHeight 比 getBoundingClientRect 更便宜，且含 padding（box-sizing）
      const h = el.offsetHeight || el.getBoundingClientRect().height
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
    const sh = el.scrollHeight
    el.scrollTop = sh
    lastScrollHeightRef.current = sh
  }, [])

  const scheduleStickBottom = useCallback(() => {
    if (userInteractedUp.current) return
    if (scrollScheduledRef.current) return
    scrollScheduledRef.current = true
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
    // 仅会话切换时重置；勿依赖 count / lastMessage.id 以免流式中反复清缓存
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionKey 驱动重置
  }, [sessionKey, loadingHistory, stickScrollToBottom])

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

  // 流式：history totalSize / live 文本变长时降频贴底
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

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="chat-viewport-wrapper">
      <div
        className="chat-viewport chat-viewport-virtual"
        ref={viewportRef}
        onScroll={onViewportScroll}
        onWheel={onWheel}
      >
        {/* history：虚拟列表，稳定高度 */}
        <div
          className="messages-container messages-container-virtual"
          style={{
            height: historyCount > 0 ? totalSize : 0,
            position: 'relative',
            width: '90%',
            maxWidth: 768,
            margin: '0 auto',
          }}
        >
          {virtualItems.map((vi) => {
            const m = messages[vi.index]
            if (!m) return null
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                // 不直接把 measureElement 当 ref：它在 attach 时可能同步触发
                // onChange(sync)；配合 useFlushSync:false 仍更安全地延后一帧测高。
                ref={(node) => {
                  if (!node) return
                  // 微任务：躲开 commitLayout / attachRef 同步路径
                  queueMicrotask(() => {
                    virtualizer.measureElement(node)
                  })
                }}
                className="message-virtual-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  paddingBottom: ITEM_GAP,
                  boxSizing: 'border-box',
                }}
              >
                <MessageItem message={m} streaming={false} />
              </div>
            )
          })}
        </div>

        {/* live：流式末条，普通 DOM，不进 virtualizer measure */}
        {liveMessage && (
          <div
            className="messages-container messages-live-tail"
            style={{
              width: '90%',
              maxWidth: 768,
              margin: '0 auto',
              paddingBottom: ITEM_GAP,
              boxSizing: 'border-box',
            }}
          >
            <MessageItem message={liveMessage} streaming />
          </div>
        )}
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
