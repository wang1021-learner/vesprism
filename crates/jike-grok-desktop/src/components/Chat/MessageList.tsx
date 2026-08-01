import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  memo,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '@nanostores/react'
import type { ChatMessage, PermissionRequest } from '../../types'
import { $activeChatId, $sessionPhase } from '../../store'
import { MessageItem } from './MessageItem'

/** 行间距（原 .messages-container gap: 24px） */
const ROW_GAP = 24
/** 列表底部留白 */
const LIST_PAD_BOTTOM = 6
/** 默认估高：减少首屏测高跳动 */
const DEFAULT_ESTIMATE = 96

interface MessageListProps {
  messages: ChatMessage[]
  streaming: boolean
  permission: PermissionRequest | null
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

function estimateMessageHeight(msg: ChatMessage | undefined): number {
  if (!msg) return DEFAULT_ESTIMATE
  switch (msg.role) {
    case 'system':
      return 40 + ROW_GAP
    case 'thought':
      return (msg.isStreaming ? 36 : 32) + ROW_GAP
    case 'tool':
      return 40 + ROW_GAP
    case 'user': {
      const lines = Math.min(12, Math.ceil((msg.text?.length || 0) / 48) || 1)
      return Math.min(280, 48 + lines * 20) + ROW_GAP
    }
    case 'assistant': {
      const lines = Math.min(40, Math.ceil((msg.text?.length || 0) / 60) || 1)
      return Math.min(640, 56 + lines * 18) + ROW_GAP
    }
    default:
      return DEFAULT_ESTIMATE + ROW_GAP
  }
}

/**
 * 虚拟列表对话视窗：
 * - @tanstack/react-virtual 只挂载可见区 + overscan
 * - 按 message id 缓存测高，切会话/回滚复用
 * - 打开历史：paint 前贴底 + 未就绪时透明
 * - 贴底时流式自动跟滚；用户上滚锁定 +「回到底部」
 */
export const MessageList = memo(function MessageList({
  messages,
  streaming,
}: MessageListProps) {
  const phase = useStore($sessionPhase)
  const activeChatId = useStore($activeChatId)
  const loadingHistory = phase === 'loading'
  const viewportRef = useRef<HTMLDivElement>(null)
  const userPinnedUp = useRef(false)
  const [showJump, setShowJump] = useState(false)
  /** 贴底完成前 opacity:0，避免首帧停在顶部 */
  const [scrollReady, setScrollReady] = useState(true)
  const scrollRaf = useRef(0)
  const lastScrollHeight = useRef(0)
  const lastChatKey = useRef('')
  const prevCount = useRef(0)
  /** messageId → 实测高度（含 gap） */
  const heightCacheRef = useRef(new Map<string, number>())
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const count = messages.length
  const last = count > 0 ? messages[count - 1] : undefined
  const lastId = last?.id ?? ''
  const lastLen = last?.text?.length ?? 0
  const lastToolPreview = last?.role === 'tool' ? last.toolCall?.preview?.length ?? 0 : 0
  const chatKey = activeChatId || 'empty'

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => {
      const msg = messagesRef.current[index]
      if (!msg) return DEFAULT_ESTIMATE + ROW_GAP
      const cached = heightCacheRef.current.get(msg.id)
      if (cached && cached > 0) return cached
      return estimateMessageHeight(msg)
    },
    getItemKey: (index) => messagesRef.current[index]?.id ?? index,
    overscan: 12,
    measureElement: (el) => {
      const height = el.getBoundingClientRect().height
      const index = Number(el.getAttribute('data-index'))
      const id = messagesRef.current[index]?.id
      if (id && height > 0) {
        heightCacheRef.current.set(id, height)
      }
      return height
    },
  })

  const totalSize = virtualizer.getTotalSize()

  /**
   * 贴底只信 scrollHeight。
   * scrollToIndex(align:end) 依赖行高估测，估高未收敛时本身就会偏；
   * 对「滚到最底」这个语义，scrollTop = scrollHeight 就是正确答案。
   * 虚拟列表仍会随 scroll 位置挂载底部行并完成测高。
   */
  const stickToBottom = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    lastScrollHeight.current = el.scrollHeight
  }, [])

  const scheduleStick = useCallback(() => {
    if (userPinnedUp.current) return
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      if (userPinnedUp.current) return
      stickToBottom()
    })
  }, [stickToBottom])

  const pauseAutoScroll = useCallback(() => {
    if (userPinnedUp.current) return
    if (!scrollReady) return
    userPinnedUp.current = true
    setShowJump(true)
  }, [scrollReady])

  /** 点击「回到底部」：平滑滚到底，再恢复自动贴底 */
  const resumeAutoScroll = useCallback(() => {
    const el = viewportRef.current
    userPinnedUp.current = false
    setShowJump(false)
    if (!el) {
      stickToBottom()
      return
    }
    const target = Math.max(0, el.scrollHeight - el.clientHeight)
    if (target - el.scrollTop < 8) {
      stickToBottom()
      return
    }
    el.scrollTo({ top: target, behavior: 'smooth' })
    window.setTimeout(() => {
      if (!userPinnedUp.current) stickToBottom()
    }, 320)
  }, [stickToBottom])

  const onViewportScroll = useCallback(() => {
    if (!scrollReady) return
    const el = viewportRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = gap < (streaming ? 96 : 48)
    if (nearBottom) {
      if (userPinnedUp.current) {
        userPinnedUp.current = false
        setShowJump(false)
      }
    } else if (gap > 100) {
      pauseAutoScroll()
    }
  }, [pauseAutoScroll, streaming, scrollReady])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!scrollReady) return
      if (e.deltaY < 0) pauseAutoScroll()
    },
    [pauseAutoScroll, scrollReady],
  )

  const onTouchMove = useCallback(() => {
    if (!scrollReady) return
    const el = viewportRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (gap > 80) pauseAutoScroll()
  }, [pauseAutoScroll, scrollReady])

  /**
   * 打开历史 / 空→有消息：
   * 1) 先隐藏  2) layout 内贴底  3) 再显示
   */
  useLayoutEffect(() => {
    const chatChanged = chatKey !== lastChatKey.current
    const becamePopulated = prevCount.current === 0 && count > 0
    prevCount.current = count

    if (chatChanged) {
      lastChatKey.current = chatKey
      userPinnedUp.current = false
      setShowJump(false)
      lastScrollHeight.current = 0
    }

    if (count === 0) {
      setScrollReady(true)
      return
    }

    if (chatChanged || becamePopulated || loadingHistory) {
      setScrollReady(false)
      stickToBottom()
      requestAnimationFrame(() => {
        stickToBottom()
        // 虚拟列表首轮测高后 totalSize 会变，再钉一次
        requestAnimationFrame(() => {
          stickToBottom()
          setScrollReady(true)
          requestAnimationFrame(() => {
            if (!userPinnedUp.current) stickToBottom()
          })
        })
      })
    }
  }, [chatKey, count, lastId, loadingHistory, stickToBottom])

  // 非流式：新消息 / 换尾条时贴底
  useLayoutEffect(() => {
    if (!scrollReady || userPinnedUp.current || count === 0) return
    if (streaming) return
    stickToBottom()
  }, [count, lastId, streaming, scrollReady, stickToBottom])

  // 流式：尾条变长 / totalSize 变大时跟滚（高度差补偿）。
  // useLayoutEffect 保证和 DOM commit 同步完成，避免 paint 后调整引起的抖动。
  useLayoutEffect(() => {
    if (!scrollReady || userPinnedUp.current || count === 0) return
    if (!streaming) return
    const el = viewportRef.current
    if (!el) return
    const prev = lastScrollHeight.current
    const next = el.scrollHeight
    if (next > prev && prev > 0) {
      el.scrollTop += next - prev
    } else {
      stickToBottom()
    }
    lastScrollHeight.current = el.scrollHeight
  }, [
    lastLen,
    lastToolPreview,
    lastId,
    count,
    streaming,
    scrollReady,
    totalSize,
    stickToBottom,
  ])

  // 流式中强制重测最后一项（Markdown 变高时 ResizeObserver 偶发滞后）
  useLayoutEffect(() => {
    if (!streaming || count === 0) return
    const items = virtualizer.getVirtualItems()
    const lastVirtual = items.find((v) => v.index === count - 1)
    if (!lastVirtual) {
      // 最后一项不在 DOM：贴底让 virtualizer 挂载尾部再测高
      if (!userPinnedUp.current) stickToBottom()
      return
    }
    const row = viewportRef.current?.querySelector(
      `[data-index="${count - 1}"]`,
    ) as HTMLElement | null
    if (row) {
      virtualizer.measureElement(row)
    }
  }, [lastLen, lastToolPreview, streaming, count, virtualizer, stickToBottom])

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

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="chat-viewport-wrapper">
      <div
        className={`chat-viewport chat-viewport-virtual${scrollReady ? ' is-scroll-ready' : ' is-scroll-pending'}`}
        ref={viewportRef}
        onScroll={onViewportScroll}
        onWheel={onWheel}
        onTouchMove={onTouchMove}
      >
        <div
          className="messages-container messages-container-virtual"
          style={{
            height: totalSize + LIST_PAD_BOTTOM,
            position: 'relative',
            width: '90%',
            maxWidth: 768,
            margin: '0 auto',
          }}
        >
          {virtualItems.map((vr) => {
            const msg = messages[vr.index]
            if (!msg) return null
            const isLive =
              Boolean(msg.isStreaming) ||
              (streaming &&
                vr.index === count - 1 &&
                (msg.role === 'thought' ||
                  msg.role === 'assistant' ||
                  msg.role === 'tool'))
            return (
              <div
                key={msg.id}
                data-index={vr.index}
                ref={virtualizer.measureElement}
                className="message-virtual-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vr.start}px)`,
                  paddingBottom: vr.index < count - 1 ? ROW_GAP : 0,
                }}
              >
                <MessageItem message={msg} streaming={isLive} />
              </div>
            )
          })}
        </div>
      </div>

      {showJump && scrollReady ? (
        <button
          type="button"
          className="jump-to-bottom-btn"
          onClick={() => resumeAutoScroll()}
          title="回到底部"
          aria-label="回到底部"
        >
          <span className="jump-to-bottom-icon">
            <DownArrowIcon />
          </span>
        </button>
      ) : null}
    </div>
  )
})
