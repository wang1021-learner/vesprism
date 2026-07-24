import type { ChatMessage } from '../../types'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ToolCallCard } from './ToolCallCard'

interface MessageItemProps {
  message: ChatMessage
}

export function MessageItem({ message }: MessageItemProps) {
  const { role, text, tool } = message

  if (role === 'system') {
    return (
      <div className="message-row system-row">
        <div className="system-pill">{text}</div>
      </div>
    )
  }

  if (role === 'user') {
    return (
      <div className="message-row user-row">
        <div className="bubble bubble-user">
          <pre className="bubble-text">{text}</pre>
        </div>
      </div>
    )
  }

  if (role === 'thought') {
    return (
      <div className="message-row thought-row">
        <div className="bubble bubble-thought">
          <div className="thought-header">💭 思考推演</div>
          <pre className="bubble-text">{text}</pre>
        </div>
      </div>
    )
  }

  if (role === 'tool' && tool) {
    return (
      <div className="message-row tool-row">
        <ToolCallCard tool={tool} />
      </div>
    )
  }

  // Assistant
  return (
    <div className="message-row assistant-row">
      <div className="assistant-badge">
        <span className="badge-icon">✦</span>
        <span className="badge-text">Assistant</span>
      </div>
      <div className="assistant-content">
        <AssistantMarkdown text={text} />
      </div>
    </div>
  )
}
