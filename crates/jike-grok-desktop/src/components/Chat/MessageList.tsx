import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  memo,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStickToBottom } from 'use-stick-to-bottom'
import { useStore } from '@nanostores/react'
import type { ChatMessage, PermissionRequest } from '../../types'
import { $activeChatId, $sessionPhase } from '../../store'
import { MessageItem } from './MessageItem'
import { ChatTimeline } from './ChatTimeline'

/** 默认行间距（turn 级）；scaffold / user 另见 gapBefore */
const ROW_GAP = 12
/** 列表底部留白 */
const LIST_PAD_BOTTOM = 6
/** 默认估高：减少首屏测高跳动 */
const DEFAULT_ESTIMATE = 96
/** 内容区最大宽度 48.75rem */
const CONTENT_MAX_WIDTH = '48.75rem'
/** 大上下文阈值：超过后提高 overscan；DOM 仍只渲染可视区 */
const LARGE_CONTEXT_THRESHOLD = 200
/** 高度缓存软上限 */
const HEIGHT_CACHE_SOFT_MAX = 800
/**
 * 流式行高系数（px/行）：宁高勿低。
 * 代码块 / 表格 / 列表的实测高度常高于「48 字符/行 × 18px」的粗略估算，
 * 估高偏低会让每帧实测修正时内容「向上顶」，产生推挤感。偏保守则总高度略大、
 * 由 measureElement 实测收敛，视觉更稳。
 */
const STREAM_LINE_HEIGHT = 20
/** 估高的基准字符密度：每行按多少字符折算（越小越保守） */
const EST_CHARS_PER_LINE = 48

/** 高度缓存：实测高度 + 该高度对应的文本长度（增量预测的锚点） */
interface HeightRecord {
  h: number
  len: number
}

/** scaffold(tool/thought)=4 · turn=12 · user 前=16 */
function gapBefore(msg: ChatMessage | undefined, prev: ChatMessage | undefined): number {
  if (!msg || !prev) return 0
  if (msg.role === 'user') return 16
  const scaffold = (r: string) => r === 'tool' || r === 'thought'
  if (scaffold(msg.role) && scaffold(prev.role)) return 4
  if (scaffold(msg.role) && prev.role === 'assistant') return 4
  if (msg.role === 'assistant' && scaffold(prev.role)) return 4
  return ROW_GAP
}

interface MessageListProps {
  messages: ChatMessage[]
  streaming: boolean
  permission: PermissionRequest | null
  onFocusUserQuestion?: (toolCallId: string) => void
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
  const len = msg.text?.length || 0
  switch (msg.role) {
    case 'system':
      return 40 + ROW_GAP
    case 'thought': {
      // 流式思考默认展开：按文案估高，避免 virtualizer 总高度偏小、贴底失效
      if (msg.isStreaming && len > 0) {
        const lines = Math.min(80, Math.ceil(len / EST_CHARS_PER_LINE) || 1)
        return Math.min(720, 40 + lines * (STREAM_LINE_HEIGHT - 2)) + ROW_GAP
      }
      return 32 + ROW_GAP
    }
    case 'tool':
      // 对齐 OpenWorker：工具行默认折叠（行摘要 + 内容 opt-in），行高固定为 header，
      // 估高即实际；展开态由 measureElement 实测收敛。
      return 40 + ROW_GAP
    case 'user': {
      const lines = Math.min(12, Math.ceil(len / EST_CHARS_PER_LINE) || 1)
      return Math.min(280, 48 + lines * 20) + ROW_GAP
    }
    case 'assistant': {
      // 流式长文：放宽估高上限，跟滚才跟得上；流式用偏保守行高（代码块实测常 >18px）
      const live = msg.isStreaming
      const lines = Math.min(live ? 120 : 40, Math.ceil(len / EST_CHARS_PER_LINE) || 1)
      const cap = live ? 2400 : 640
      const lineH = live ? STREAM_LINE_HEIGHT : 18
      return Math.min(cap, 56 + lines * lineH) + ROW_GAP
    }
    default:
      return DEFAULT_ESTIMATE + ROW_GAP
  }
}

function trimHeightCache(cache: Map<string, HeightRecord>, keepIds: Set<string>) {
  if (cache.size <= HEIGHT_CACHE_SOFT_MAX) return
  for (const id of [...cache.keys()]) {
    if (!keepIds.has(id)) cache.delete(id)
    if (cache.size <= HEIGHT_CACHE_SOFT_MAX * 0.75) break
  }
}

/**
 * 对话视窗（A：TanStack Virtual + use-stick-to-bottom）
 * - scrollTop 唯一写手：use-stick-to-bottom（instant）
 * - 历史/大上下文：virtual 只挂可视区 + overscan
 * - 流式尾条估高随字数涨，content resize 触发库贴底
 * - 切会话 clear 高度缓存；大上下文缓存软上限
 */
export const MessageList = memo(function MessageList({
  messages,
  streaming,
  permission,
  onFocusUserQuestion,
}: MessageListProps) {
  const phase = useStore($sessionPhase)
  const activeChatId = useStore($activeChatId)
  const loadingHistory = phase === 'loading'

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    initial: 'instant',
    resize: 'instant',
  })

  /** virtualizer / timeline 用的 scroll 元素 */
  const viewportElRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  /** 贴底完成前 opacity:0，避免首帧停在顶部 */
  const [scrollReady, setScrollReady] = useState(true)
  const lastChatKey = useRef('')
  const prevCount = useRef(0)
  /** 上一条已处理过的用户消息 id：发送时强制贴底用（避免重复触发） */
  const prevLastUserMsgId = useRef('')
  /** messageId → 实测高度 + 对应文本长度（含 gap） */
  const heightCacheRef = useRef(new Map<string, HeightRecord>())
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  const count = messages.length
  const hasMessages = count > 0
  const last = hasMessages ? messages[count - 1] : undefined
  const lastId = last?.id ?? ''
  const lastLen = last?.text?.length ?? 0
  const lastToolPreview =
    last?.role === 'tool' ? (last.toolCall?.preview?.length ?? 0) : 0
  const lastToolTitle = last?.role === 'tool' ? (last.toolCall?.title ?? '') : ''
  const lastStreaming = Boolean(last?.isStreaming)
  const tailLive =
    streaming ||
    lastStreaming ||
    (last?.role === 'tool' &&
      (last.toolCall?.status === 'in_progress' ||
        last.toolCall?.status === 'pending'))
  const chatKey = activeChatId || 'empty'
  const largeContext = count >= LARGE_CONTEXT_THRESHOLD
  const overscan = largeContext ? (tailLive ? 10 : 16) : 12

  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      viewportElRef.current = el
      scrollRef(el)
    },
    [scrollRef],
  )

  const setContentEl = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef(el)
    },
    [contentRef],
  )

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewportElRef.current,
    estimateSize: (index) => {
      const msg = messagesRef.current[index]
      if (!msg) return DEFAULT_ESTIMATE + ROW_GAP
      const estimated = estimateMessageHeight(msg)
      const rec = heightCacheRef.current.get(msg.id)
      const cached = rec?.h ?? 0
      // 流式尾条：估高必须随字数涨，否则 totalSize 卡住 → scrollHeight 不涨 → 假死不跟滚
      const isTail =
        index === messagesRef.current.length - 1 &&
        (Boolean(msg.isStreaming) ||
          (streamingRef.current &&
            (msg.role === 'assistant' || msg.role === 'thought')))
      if (isTail) {
        // 增量预测：以「上次实测高度」为锚，叠加本帧新增字符对应的行数。
        // 相比对全文重新估算，实测锚点更准、单调递增，且避免代码块/表格
        // 估高偏低导致的「每帧向上顶」推挤感。无锚点（首帧）时返回保守估高。
        const len = msg.text?.length ?? 0
        const delta = rec ? Math.max(0, len - rec.len) : 0
        const addedLines =
          delta > 0 ? Math.max(1, Math.ceil(delta / EST_CHARS_PER_LINE)) : 0
        const base = cached > 0 ? cached : estimated
        return base + addedLines * STREAM_LINE_HEIGHT
      }
      if (cached > 0) return cached
      return estimated
    },
    getItemKey: (index) => messagesRef.current[index]?.id ?? index,
    overscan,
    measureElement: (el) => {
      // 始终用真实 DOM 高度；虚拟列表 totalSize 与真实内容必须一致，否则贴底假死
      const height = el.getBoundingClientRect().height
      const index = Number(el.getAttribute('data-index'))
      const msg = messagesRef.current[index]
      if (msg && height > 0) {
        heightCacheRef.current.set(msg.id, {
          h: height,
          len: msg.text?.length ?? 0,
        })
      }
      return height
    },
  })

  const totalSize = virtualizer.getTotalSize()

  // 流式尾条：只抬 totalSize / 测高，scrollTop 交给 stick 库（ResizeObserver）
  useLayoutEffect(() => {
    if (!hasMessages || !tailLive) return
    if (lastId) heightCacheRef.current.delete(lastId)
    const row = viewportElRef.current?.querySelector(
      '[data-index="' + String(count - 1) + '"]',
    ) as HTMLElement | null
    if (row) {
      try {
        virtualizer.measureElement(row)
      } catch {
        /* ignore */
      }
    }
  }, [
    lastLen,
    lastToolPreview,
    lastToolTitle,
    lastId,
    count,
    tailLive,
    hasMessages,
    virtualizer,
  ])

  // 大上下文：仅在条数变化时清理缓存（勿依赖 messages 引用，避免流式每帧扫 map）
  useEffect(() => {
    if (!largeContext) return
    const ids = new Set(messagesRef.current.map((m) => m.id))
    trimHeightCache(heightCacheRef.current, ids)
  }, [largeContext, count])

  /**
   * 打开历史 / 切会话：instant 贴底 + 首帧防闪
   */
  useLayoutEffect(() => {
    const chatChanged = chatKey !== lastChatKey.current
    const becamePopulated = prevCount.current === 0 && count > 0
    prevCount.current = count

    if (chatChanged) {
      lastChatKey.current = chatKey
      heightCacheRef.current.clear()
    }

    if (count === 0) {
      setScrollReady(true)
      return
    }

    if (chatChanged || becamePopulated || loadingHistory) {
      setScrollReady(false)
      void scrollToBottom({ animation: 'instant' })
      requestAnimationFrame(() => {
        void scrollToBottom({ animation: 'instant' })
        requestAnimationFrame(() => {
          void scrollToBottom({ animation: 'instant' })
          setScrollReady(true)
        })
      })
    }
  }, [chatKey, count, lastId, loadingHistory, scrollToBottom])

  // 发送新消息（新增用户气泡）：即使列表不在底部也强制贴底——
  // 用户主动发送即开始新回合，自己的消息与回复必须可见；
  // 用 smooth 平滑滚回（区别于流式跟滚的 instant，让用户感知位置变化）
  useLayoutEffect(() => {
    if (!scrollReady || count === 0) return
    const lastMsg = messages[count - 1]
    if (!lastMsg || lastMsg.role !== 'user') return
    if (lastMsg.id === prevLastUserMsgId.current) return
    prevLastUserMsgId.current = lastMsg.id
    void scrollToBottom({ animation: 'smooth' })
  }, [count, lastId, scrollReady, scrollToBottom, messages])

  // 非流式新消息且仍在底部
  useLayoutEffect(() => {
    if (!scrollReady || count === 0) return
    if (tailLive) return
    if (!isAtBottom) return
    void scrollToBottom({ animation: 'instant' })
  }, [count, lastId, tailLive, scrollReady, isAtBottom, scrollToBottom])

  const onJump = useCallback(() => {
    // 原生 smooth 回到底部，与 ChatTimeline 刻度跳转同一机制/速度
    // （virtualizer.scrollToIndex → 浏览器平滑滚动，距离自适应、可被滚轮打断）
    if (count === 0) return
    virtualizer.scrollToIndex(count - 1, { align: 'end', behavior: 'smooth' })
  }, [virtualizer, count])

  if (loadingHistory && messages.length === 0) {
    return (
      <div className="chat-viewport-wrapper" ref={wrapperRef}>
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
      <div className="chat-viewport-wrapper" ref={wrapperRef}>
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

  // 权限审批的发起行：最后一个 in_progress/pending 工具行（Hermes positional 方案）
  let permissionOriginId = ''
  if (permission) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'tool' || !m.toolCallId) continue
      const st = m.toolCall?.status
      if (st === 'in_progress' || st === 'pending' || m.isStreaming) {
        permissionOriginId = m.toolCallId
        break
      }
    }
  }

  const virtualItems = virtualizer.getVirtualItems()
  const showJump = !isAtBottom && scrollReady

  return (
    <div className="chat-viewport-wrapper" ref={wrapperRef}>
      <div
        className={
          'chat-viewport chat-viewport-virtual' +
          (scrollReady ? ' is-scroll-ready' : ' is-scroll-pending')
        }
        ref={setScrollEl}
        data-following={isAtBottom ? 'true' : 'false'}
        data-large-context={largeContext ? 'true' : 'false'}
      >
        <div
          className="messages-container messages-container-virtual"
          ref={setContentEl}
          style={{
            height: totalSize + LIST_PAD_BOTTOM,
            position: 'relative',
            width: '90%',
            maxWidth: CONTENT_MAX_WIDTH,
            margin: '0 auto',
          }}
        >
          {virtualItems.map((vr) => {
            const msg = messages[vr.index]
            if (!msg) return null
            // 工具行只看自身 isStreaming/status，勿因「整轮还在 generating」把已完成工具强行 live（会一直转圈）
            const isLive =
              Boolean(msg.isStreaming) ||
              (streaming &&
                vr.index === count - 1 &&
                (msg.role === 'thought' || msg.role === 'assistant'))
            const next = messages[vr.index + 1]
            const padBottom =
              vr.index < count - 1 ? gapBefore(next, msg) || ROW_GAP : 0
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
                  paddingBottom: padBottom,
                }}
              >
                <MessageItem
                  message={msg}
                  streaming={isLive}
                  onFocusUserQuestion={onFocusUserQuestion}
                  isPermissionOrigin={
                    msg.role === 'tool' && msg.toolCallId === permissionOriginId
                  }
                />
              </div>
            )
          })}
        </div>
      </div>

      {showJump ? (
        <button
          type="button"
          className="jump-to-bottom-btn"
          onClick={onJump}
          title="回到底部"
          aria-label="回到底部"
        >
          <span className="jump-to-bottom-icon">
            <DownArrowIcon />
          </span>
        </button>
      ) : null}

      <ChatTimeline messages={messages} virtualizer={virtualizer} />
    </div>
  )
})
