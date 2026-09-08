import { useState } from 'react'
import type { OfficeMessage, OfficeTask } from './model'
import { openOfficeArtifact } from './store'

function safeText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function ConversationStream({
  task,
  onOpenArtifact,
}: {
  task: OfficeTask
  onOpenArtifact?: () => void
}) {
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({})

  const toggleTool = (id: string) => {
    setExpandedToolIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const openArtifact = () => {
    if (onOpenArtifact) onOpenArtifact()
    else openOfficeArtifact()
  }

  const messages: OfficeMessage[] = task.messages && task.messages.length > 0
    ? task.messages
    : [
        { id: 'user-default', kind: 'user', content: task.prompt || task.title, done: true },
        ...(task.plan.map((s, idx) => ({
          id: `step-${idx}`,
          kind: 'tool_call' as const,
          content: s.label,
          toolName: s.toolName,
          detail: s.detail,
          done: idx <= task.stepIndex,
        }))),
        ...(task.status === 'done'
          ? [
              {
                id: 'done-msg',
                kind: 'text' as const,
                content: `任务已完成。已为您生成《${task.file?.name || '交付成果'}》，可在右侧查看或导出产物。`,
                done: true,
              },
              ...(task.file
                ? [
                    {
                      id: 'done-art',
                      kind: 'artifact' as const,
                      content: task.file.name || '交付文档',
                      done: true,
                    },
                  ]
                : []),
            ]
          : []),
      ]

  return (
    <div className="oc-stream-container" role="region" aria-label="执行会话流">
      <div className="oc-stream-inner">
        {messages.map((msg) => {
          if (msg.kind === 'user') {
            return (
              <div key={msg.id} className="oc-msg is-user">
                <div className="oc-msg-bubble is-user">
                  <p>{safeText(msg.content)}</p>
                </div>
              </div>
            )
          }

          if (msg.kind === 'thinking') {
            return (
              <div key={msg.id} className="oc-msg is-assistant">
                <div className="oc-msg-bubble is-thinking">
                  <div className="oc-thinking-pulse" aria-hidden="true">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                  <span className="oc-thinking-text">{safeText(msg.content)}</span>
                </div>
              </div>
            )
          }

          if (msg.kind === 'tool_call') {
            const isExpanded = expandedToolIds[msg.id] ?? false
            return (
              <div key={msg.id} className="oc-msg is-assistant">
                <div className={`oc-tool-card${msg.done ? ' is-done' : ' is-running'}`}>
                  <button
                    type="button"
                    className="oc-tool-header"
                    onClick={() => toggleTool(msg.id)}
                    aria-expanded={isExpanded}
                  >
                    <span className="oc-tool-status-icon">
                      {msg.done ? (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <span className="oc-spinner" />
                      )}
                    </span>
                    <span className="oc-tool-title">
                      {msg.toolName ? <code className="oc-tool-tag">{msg.toolName}</code> : null}
                      <span className="oc-tool-desc">{safeText(msg.content)}</span>
                    </span>
                    <span className="oc-tool-expand-icon" aria-hidden="true">
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  </button>
                  {isExpanded && msg.detail ? (
                    <div className="oc-tool-detail">
                      <p>{safeText(msg.detail)}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          }

          if (msg.kind === 'text') {
            const full = safeText(msg.content)
            let shown = full
            if (!msg.done && task.streamCursor !== undefined) {
              shown = full.slice(0, Math.max(0, task.streamCursor ?? 0))
            } else if (full.length > 300) {
              shown = `${full.slice(0, 300)}…`
            }
            return (
              <div key={msg.id} className="oc-msg is-assistant">
                <div className="oc-msg-bubble is-assistant">
                  <div className="oc-prose">
                    <p>{shown}</p>
                  </div>
                  {!msg.done && <span className="oc-cursor" aria-hidden="true" />}
                </div>
              </div>
            )
          }

          if (msg.kind === 'artifact') {
            // 无 file 时不渲染产物卡片
            if (!task.file) return null
            return (
              <div key={msg.id} className="oc-msg is-assistant">
                <div className="oc-artifact-card">
                  <div className="oc-art-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="oc-art-info">
                    <strong>{safeText(msg.content) || task.file.name}</strong>
                    <span>可在右侧查看或导出产物</span>
                  </div>
                  <button
                    type="button"
                    className="oc-art-btn"
                    onClick={openArtifact}
                  >
                    查看产物 →
                  </button>
                </div>
              </div>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
