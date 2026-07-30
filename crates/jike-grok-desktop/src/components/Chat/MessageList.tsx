import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  memo,
} from 'react'
import { useStore } from '@nanostores/react'
import type { ChatMessage, PermissionRequest } from '../../types'
import { $activeChatId, $sessionPhase } from '../../store'
import { MessageItem } from './MessageItem'

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

/**
 * 对话列表滚动策略：
 * - 打开历史：paint 前贴底 + 未就绪时透明，避免「先顶后底」
 * - 贴底时：流式自动跟滚
 * - 用户上滚：锁定，显示「回到底部」
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

  const count = messages.length
  const last = count > 0 ? messages[count - 1] : undefined
  const lastId = last?.id ?? ''
  const lastLen = last?.text?.length ?? 0
  const chatKey = activeChatId || 'empty'

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
    const target = el.scrollHeight - el.clientHeight
    // 距离很近时直接贴底，避免无意义动画
    if (target - el.scrollTop < 8) {
      stickToBottom()
      return
    }
    el.scrollTo({ top: target, behavior: 'smooth' })
    // smooth 结束后再钉一次（内容若增高）
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
   * 1) 先隐藏  2) layout 内 scrollTop=max  3) 再显示
   * 以前 loading 时跳过贴底，等 ready 才跳 → 先顶后底。
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
      // 加载中空列表 / 新对话：直接可交互
      setScrollReady(true)
      return
    }

    // 需要「先贴底再露脸」的场景
    if (chatChanged || becamePopulated || loadingHistory) {
      setScrollReady(false)
      stickToBottom()
      requestAnimationFrame(() => {
        stickToBottom()
        setScrollReady(true)
        requestAnimationFrame(() => {
          if (!userPinnedUp.current) stickToBottom()
        })
      })
      return
    }

    // 同会话非流式更新（一般由其它 effect 处理）
  }, [chatKey, count, lastId, loadingHistory, stickToBottom])

  // 非流式消息变化跟滚（用户未上锁）
  useLayoutEffect(() => {
    if (!scrollReady || userPinnedUp.current || count === 0) return
    if (streaming) return
    stickToBottom()
  }, [count, lastId, streaming, scrollReady, stickToBottom])

  // 流式跟滚
  useEffect(() => {
    if (!scrollReady || userPinnedUp.current || count === 0) return
    if (!streaming) return
    const el = viewportRef.current
    if (!el) return
    const prev = lastScrollHeight.current
    const next = el.scrollHeight
    if (next > prev && prev > 0) {
      el.scrollTop += next - prev
    } else {
      el.scrollTop = next
    }
    lastScrollHeight.current = el.scrollHeight
  }, [lastLen, lastId, count, streaming, scrollReady, messages])

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
      <div
        className={`chat-viewport${scrollReady ? ' is-scroll-ready' : ' is-scroll-pending'}`}
        ref={viewportRef}
        onScroll={onViewportScroll}
        onWheel={onWheel}
        onTouchMove={onTouchMove}
      >
        <div className="messages-container">
          {messages.map((msg, i) => {
            const isLive =
              Boolean(msg.isStreaming) ||
              (streaming &&
                i === messages.length - 1 &&
                (msg.role === 'thought' || msg.role === 'assistant'))
            return (
              <MessageItem key={msg.id} message={msg} streaming={isLive} />
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
