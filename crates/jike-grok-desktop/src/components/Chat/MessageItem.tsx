import { memo, useState } from 'react'
import type { ChatMessage } from '../../types'
import { AssistantMarkdown } from './AssistantMarkdown'

const USER_BUBBLE_FOLD_THRESHOLD = 600

interface MessageItemProps {
  message: ChatMessage
  streaming?: boolean
}

export const MessageItem = memo(function MessageItem({
  message,
  streaming = false,
}: MessageItemProps) {
  switch (message.role) {
    case 'system':
      return (
        <div className="message-row system-row">
          <div className="system-pill">{message.text}</div>
        </div>
      )

    case 'user':
      return <UserBubble text={message.text} />

    case 'thought':
      return <ThoughtBubble text={message.text} streaming={streaming} />

    case 'tool':
      return (
        <div className="message-row tool-row">
          <div className="tool-card">
            <div className="tool-card-header">
              <span className="tool-label">🔧 {message.tool || 'tool'}</span>
            </div>
            {message.text ? (
              <pre className="tool-output bubble-text">{message.text}</pre>
            ) : null}
          </div>
        </div>
      )

    case 'assistant':
      return (
        <div className="message-row assistant-row">
          <div className="assistant-badge">
            <span className="badge-icon">✦</span>
            <span className="badge-text">Assistant</span>
          </div>
          <div className="assistant-content md-body">
            <AssistantMarkdown text={message.text} />
          </div>
        </div>
      )

    default:
      return null
  }
})

const ThoughtBubble = memo(function ThoughtBubble({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  // 流式默认展开；结束后默认折叠，可点开
  const [userExpanded, setUserExpanded] = useState(false)
  const expanded = streaming || userExpanded
  const charHint = text.length > 0 ? `${text.length.toLocaleString()} 字符` : ''

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
            {!streaming && charHint ? (
              <span className="thought-meta">{charHint}</span>
            ) : null}
          </span>
          <span className="thought-header-right" aria-hidden>
            {streaming ? (
              <span className="thought-streaming-dot" />
            ) : (
              <span className={`thought-chevron${expanded ? ' open' : ''}`}>▾</span>
            )}
          </span>
        </button>
        {expanded ? <pre className="bubble-text thought-body">{text}</pre> : null}
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
        {isLong ? (
          <button
            type="button"
            className="bubble-expand-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? '收起'
              : `展开全部（${text.length.toLocaleString()} 字符）`}
          </button>
        ) : null}
      </div>
    </div>
  )
})
