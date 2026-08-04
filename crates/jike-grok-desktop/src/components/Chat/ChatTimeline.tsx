import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { ChatMessage } from '../../types'

const MIN_ENTRIES = 4
const HOVER_CLOSE_MS = 140

interface TimelineEntry {
  id: string
  index: number // 对应在 messages 数组中的索引
  preview: string
}

function timelinePreview(text: string, max: number = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

interface ChatTimelineProps {
  messages: ChatMessage[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
}

// Index-keyed ref-array setter
const listRef =
  <T,>(refs: React.RefObject<(T | null)[]>, index: number) =>
  (node: T | null) => {
    refs.current[index] = node
  }

const hoverProps = (index: number, paint: (index: number, on: boolean) => void) => ({
  onMouseEnter: () => paint(index, true),
  onMouseLeave: () => paint(index, false)
})

export const ChatTimeline = memo(function ChatTimeline({
  messages,
  virtualizer
}: ChatTimelineProps) {
  // 从所有消息中提取 User Prompt
  const entries = useMemo(() => {
    const list: TimelineEntry[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'user' && msg.text) {
        list.push({ id: msg.id, index: i, preview: timelinePreview(msg.text) })
      }
    }
    return list
  }, [messages])

  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

  const closeTimerRef = useRef<number | undefined>(undefined)
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  if (open && !everOpened) {
    setEverOpened(true)
  }

  // 核心逻辑：无需测算 DOM，直接通过 virtualizer 的状态得出当前所在的用户提问
  useEffect(() => {
    if (entries.length < MIN_ENTRIES) return
    const el = virtualizer.scrollElement
    if (!el) return

    let raf = 0
    const compute = () => {
      raf = 0
      
      // 1. 如果紧贴底部，活跃的永远是最后一个提问
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      if (isAtBottom) {
        setActiveIndex(prev => (prev === entries.length - 1 ? prev : entries.length - 1))
        return
      }

      // 2. 通过虚拟列表当前挂载的项目，找到视口顶部第一条显示的消息索引
      const visibleItems = virtualizer.getVirtualItems()
      if (visibleItems.length === 0) return
      
      const topmostVisibleIndex = visibleItems[0].index
      
      // 3. 在 entries 中找到最后一个其 index <= topmostVisibleIndex 的问题
      // （加一点 slack：哪怕刚滚走一点，也算当前问题）
      let nextActive = 0
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].index <= topmostVisibleIndex + 1) {
          nextActive = i
        } else {
          break
        }
      }
      
      setActiveIndex(prev => (prev === nextActive ? prev : nextActive))
    }

    const onScroll = () => {
      if (!raf) {
        raf = requestAnimationFrame(compute)
      }
    }

    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [entries, virtualizer])

  // 原生 DOM 操作，实现 0ms 延迟的高亮和悬停反馈，规避 React re-render
  const paint = useCallback((index: number, on: boolean) => {
    const tick = tickRefs.current[index]
    if (tick) {
      tick.style.opacity = on ? '1' : ''
    }
    const row = rowRefs.current[index]
    if (row) {
      row.classList.toggle('timeline-row-hovered', on)
      if (on) {
        row.scrollIntoView({ block: 'nearest' })
      }
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

  const jump = useCallback(
    (index: number) => {
      // 通过虚拟列表自带的方法，直接定位到指定索引的消息
      virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })
    },
    [virtualizer]
  )

  if (entries.length < MIN_ENTRIES) {
    return null
  }

  return (
    <div
      aria-label="Conversation timeline"
      className="chat-timeline-container"
      onMouseEnter={keepOpen}
      onMouseLeave={closeSoon}
      role="navigation"
    >
      <div className="chat-timeline-ticks">
        {entries.map((entry, idx) => (
          <button
            key={entry.id}
            type="button"
            className="chat-timeline-tick-btn"
            aria-label={entry.preview}
            onClick={() => jump(entry.index)}
            {...hoverProps(idx, paint)}
          >
            <span
              className={`chat-timeline-tick-line ${idx === activeIndex ? 'is-active' : ''}`}
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
              className={`chat-timeline-row ${idx === activeIndex ? 'is-active' : ''}`}
              aria-label={entry.preview}
              onClick={() => jump(entry.index)}
              ref={listRef(rowRefs, idx)}
              {...hoverProps(idx, paint)}
            >
              <span className="chat-timeline-row-text">{entry.preview}</span>
            </button>
          ))}
      </div>
    </div>
  )
})
