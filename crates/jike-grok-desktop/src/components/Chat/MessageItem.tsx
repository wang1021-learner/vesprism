import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../types'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ToolCallCard } from './ToolCallCard'

const USER_BUBBLE_FOLD_THRESHOLD = 600

interface MessageItemProps {
  message: ChatMessage
  streaming?: boolean
}

/** 非流式：引用相等即可；流式：比 text + streaming */
function messageItemEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.streaming !== next.streaming) return false
  if (!next.streaming && !prev.streaming) {
    return prev.message === next.message
  }
  // 流式末条：同一 id 下比 text
  return (
    prev.message.id === next.message.id &&
    prev.message.role === next.message.role &&
    prev.message.text === next.message.text &&
    (prev.message.role !== 'tool' ||
      (next.message.role === 'tool' &&
        prev.message.role === 'tool' &&
        prev.message.tool === next.message.tool))
  )
}

export const MessageItem = memo(function MessageItem({
  message,
  streaming = false,
}: MessageItemProps) {
  if (message.role === 'system') {
    return (
      <div className="message-row system-row">
        <div className="system-pill">{message.text}</div>
      </div>
    )
  }

  if (message.role === 'user') {
    return <UserBubble text={message.text} />
  }

  if (message.role === 'thought') {
    return <ThoughtBubble text={message.text} streaming={streaming} />
  }

  if (message.role === 'tool') {
    return (
      <div className="message-row tool-row">
        <ToolCallCard tool={message.tool} />
      </div>
    )
  }

  return (
    <div className="message-row assistant-row">
      <div className="assistant-badge">
        <span className="badge-icon">✦</span>
        <span className="badge-text">Assistant</span>
      </div>
      <div className="assistant-content">
        <AssistantMarkdown text={message.text} streaming={streaming} />
      </div>
    </div>
  )
}, messageItemEqual)

const ThoughtBubble = memo(function ThoughtBubble({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const [userExpanded, setUserExpanded] = useState(false)
  const expanded = streaming || userExpanded
  const charHint = text.length > 0 ? `${text.length.toLocaleString()} 字符` : ''
  const bodyRef = useRef<HTMLPreElement>(null)

  // thought-body 有 max-height + overflow:auto；流式时内容往下长，
  // 若不跟滚 scrollTop 会停在顶部，看起来像「思考卡住不动」。
  useLayoutEffect(() => {
    if (!streaming) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [streaming, text])

  return (
    <div className="message-row thought-row">
      <div
        className={`bubble bubble-thought${expanded ? ' is-expanded' : ' is-collapsed'}${streaming ? ' is-streaming' : ''}`}
      >
        <button
          type="button"
          className="thought-header"
          onClick={() => {
            if (streaming) return
            setUserExpanded((v) => !v)
          }}
          aria-expanded={expanded}
          disabled={streaming}
          title={
            streaming ? '思考中…' : expanded ? '收起思考过程' : '展开思考过程'
          }
        >
          <span className="thought-header-left">
            <span className="thought-icon" aria-hidden>
              💭
            </span>
            <span className="thought-title">
              {streaming ? '思考中…' : '思考过程'}
            </span>
            {!streaming && charHint && (
              <span className="thought-meta">{charHint}</span>
            )}
          </span>
          <span className="thought-header-right" aria-hidden>
            {streaming ? (
              <span className="thought-streaming-dot" />
            ) : (
              <span className={`thought-chevron${expanded ? ' open' : ''}`}>▾</span>
            )}
          </span>
        </button>
        {expanded && (
          <pre ref={bodyRef} className="bubble-text thought-body">
            {text}
          </pre>
        )}
      </div>
    </div>
  )
})

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > USER_BUBBLE_FOLD_THRESHOLD
  const displayText =
    isLong && !expanded ? text.split('\n').slice(0, 3).join('\n') : text

  return (
    <div className="message-row user-row">
      <div className="bubble bubble-user">
        <pre className="bubble-text">{displayText}</pre>
        {isLong && (
          <button
            type="button"
            className="bubble-expand-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : `展开全部（${text.length.toLocaleString()} 字符）`}
          </button>
        )}
      </div>
    </div>
  )
})
