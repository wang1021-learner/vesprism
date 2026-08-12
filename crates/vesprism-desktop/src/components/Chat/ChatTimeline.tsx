import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { ChatMessage } from '../../types'

/** 至少 2 个锚点才显示刻度 */
const MIN_ENTRIES = 2
const HOVER_CLOSE_MS = 140

type EntryKind = 'user' | 'ask_user'

interface TimelineEntry {
  id: string
  /** 在 messages 中的索引 */
  index: number
  preview: string
  kind: EntryKind
  awaiting?: boolean
}

function timelinePreview(text: string, max: number = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

function buildEntries(messages: ChatMessage[]): TimelineEntry[] {
  const list: TimelineEntry[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.text) {
      list.push({
        id: msg.id,
        index: i,
        preview: timelinePreview(msg.text),
        kind: 'user',
      })
      continue
    }
    if (msg.role === 'tool' && msg.toolCall?.kind === 'ask_user') {
      const tc = msg.toolCall
      const awaiting =
        tc.status === 'pending' || tc.status === 'in_progress'
      const raw =
        (awaiting ? tc.detail || tc.title : tc.preview || tc.detail || tc.title) ||
        '向用户提问'
      list.push({
        id: msg.id,
        index: i,
        preview: timelinePreview(
          awaiting ? `待回答 · ${raw}` : `已回答 · ${raw}`,
        ),
        kind: 'ask_user',
        awaiting,
      })
    }
  }
  return list
}

interface ChatTimelineProps {
  messages: ChatMessage[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
}

const listRef =
  <T,>(refs: React.RefObject<(T | null)[]>, index: number) =>
  (node: T | null) => {
    refs.current[index] = node
  }

const hoverProps = (index: number, paint: (index: number, on: boolean) => void) => ({
  onMouseEnter: () => paint(index, true),
  onMouseLeave: () => paint(index, false),
})

/**
 * 会话右缘中部短横刻度：
 * - 垂直居中一撮实心短横，不按全高比例铺开
 * - 无系统滚动条、无视口滑块
 * - hover 左侧弹出预览，点击跳转
 * - 含用户提问与 AI 问卷锚点
 */
export const ChatTimeline = memo(function ChatTimeline({
  messages,
  virtualizer,
}: ChatTimelineProps) {
  const entries = useMemo(() => buildEntries(messages), [messages])

  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

  const closeTimerRef = useRef<number | undefined>(undefined)
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  if (open && !everOpened) {
    setEverOpened(true)
  }

  // 滚动时更新当前高亮刻度（不画滑块）
  useEffect(() => {
    if (entries.length < MIN_ENTRIES) return
    const el = virtualizer.scrollElement
    if (!el) return

    let raf = 0
    const compute = () => {
      raf = 0
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      if (isAtBottom) {
        setActiveIndex((prev) =>
          prev === entries.length - 1 ? prev : entries.length - 1,
        )
        return
      }

      const visibleItems = virtualizer.getVirtualItems()
      if (visibleItems.length === 0) return
      const topmostVisibleIndex = visibleItems[0].index

      let nextActive = 0
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].index <= topmostVisibleIndex + 1) {
          nextActive = i
        } else {
          break
        }
      }
      setActiveIndex((prev) => (prev === nextActive ? prev : nextActive))
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }

    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [entries, virtualizer])

  const paint = useCallback((index: number, on: boolean) => {
    const tick = tickRefs.current[index]
    if (tick) {
      tick.style.opacity = on ? '1' : ''
    }
    const row = rowRefs.current[index]
    if (row) {
      row.classList.toggle('timeline-row-hovered', on)
      if (on) row.scrollIntoView({ block: 'nearest' })
    }
  }, [])

  const keepOpen = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    setOpen(true)
  }, [])

  const closeSoon = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  const jumpToMessage = useCallback(
    (entry: TimelineEntry) => {
      virtualizer.scrollToIndex(entry.index, {
        align: 'start',
        behavior: 'smooth',
      })
      if (entry.kind === 'ask_user' && entry.awaiting) {
        const msg = messages[entry.index]
        const toolCallId = msg?.toolCallId || msg?.toolCall?.toolCallId
        if (toolCallId) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('jike:focus-user-question', {
                detail: { toolCallId },
              }),
            )
          }, 120)
        }
      }
    },
    [messages, virtualizer],
  )

  if (entries.length < MIN_ENTRIES) {
    return null
  }

  return (
    <div
      aria-label="会话导航刻度"
      className="chat-timeline-container"
      onMouseEnter={keepOpen}
      onMouseLeave={closeSoon}
      role="navigation"
    >
      <div className="chat-timeline-rail">
        {entries.map((entry, idx) => (
          <button
            key={entry.id}
            type="button"
            className="chat-timeline-tick-btn"
            aria-label={entry.preview}
            aria-current={idx === activeIndex ? 'true' : undefined}
            onClick={() => jumpToMessage(entry)}
            {...hoverProps(idx, paint)}
          >
            <span
              className={[
                'chat-timeline-tick-mark',
                idx === activeIndex ? 'is-active' : '',
                entry.kind === 'ask_user' ? 'is-ask-user' : '',
                entry.awaiting ? 'is-awaiting' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              ref={listRef(tickRefs, idx)}
            />
          </button>
        ))}
      </div>

      <div className={`chat-timeline-popover ${open ? 'is-open' : 'is-closed'}`}>
        {everOpened &&
          entries.map((entry, idx) => (
            <button
              key={entry.id}
              type="button"
              className={[
                'chat-timeline-row',
                idx === activeIndex ? 'is-active' : '',
                entry.kind === 'ask_user' ? 'is-ask-user' : '',
                entry.awaiting ? 'is-awaiting' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={entry.preview}
              onClick={() => jumpToMessage(entry)}
              ref={listRef(rowRefs, idx)}
              {...hoverProps(idx, paint)}
            >
              {entry.kind === 'ask_user' ? (
                <span className="chat-timeline-row-kind" aria-hidden>
                  ?
                </span>
              ) : null}
              <span className="chat-timeline-row-text">{entry.preview}</span>
            </button>
          ))}
      </div>
    </div>
  )
})
