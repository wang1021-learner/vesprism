/**
 * 画布工作栏：运行状态与对话协同。输入框浮在画布底部。
 */
import { useStore } from '@nanostores/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { $messages } from '../../store'
import type { ChatMessage } from '../../types'
import { visibleCanvasMessages } from './visibleMessages'

type FlowRunStepLike = {
  nodeId: string
  label: string
  status: string
  output?: unknown
}

function isRunMsg(text: string): boolean {
  return /^\//.test(text.trim())
}

function formatThoughtDuration(timing?: { start: number; end?: number }): string | null {
  if (!timing?.start || !timing.end || timing.end < timing.start) return null
  const sec = (timing.end - timing.start) / 1000
  if (sec < 0.05) return null
  if (sec < 10) return `${sec.toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(sec)}s`
}

const ThoughtRow = memo(function ThoughtRow({ message }: { message: ChatMessage }) {
  const streaming = Boolean(message.isStreaming)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? streaming
  const body = (message.text || '').trim()
  const duration = formatThoughtDuration(streaming ? undefined : message.thoughtTiming)
  const title = streaming
    ? '思考中…'
    : duration
      ? `思考了 ${duration}`
      : '思考'
  return (
    <div className={`wb-msg is-thought${streaming ? ' is-live' : ''}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="wb-thought-toggle"
        onClick={() => body && setUserOpen(!open)}
        aria-expanded={open}
        disabled={!body}
      >
        <span className={`wb-thought-label${streaming ? ' is-shimmer' : ''}`}>{title}</span>
        {body ? <span className={`wb-thought-caret${open ? ' is-open' : ''}`}>›</span> : null}
      </button>
      {open && body ? <pre className="wb-thought-body">{body}</pre> : null}
    </div>
  )
})

const MessageRow = memo(function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    const isRun = isRunMsg(message.text)
    return (
      <div className={`wb-msg is-user${isRun ? ' is-run' : ''}`}>
        <span className="wb-msg-label">{isRun ? '试跑' : '你'}</span>
        <span className="wb-msg-text">{isRun ? message.text.trim().split('\n')[0] : message.text}</span>
      </div>
    )
  }
  if (message.role === 'thought') {
    return <ThoughtRow message={message} />
  }
  if (message.role === 'tool') {
    const tool = message.toolCall
    const name = tool?.title || message.tool || '工具'
    const status = tool?.status || ''
    return (
      <div className={`wb-msg is-tool is-${status || 'done'}`}>
        <span className="wb-msg-label">工具</span>
        <span className="wb-msg-text">
          {name}
          {status === 'in_progress' || status === 'pending' ? ' · 进行中' : ''}
        </span>
      </div>
    )
  }
  if (message.role === 'assistant' && message.text) {
    return (
      <div className="wb-msg is-ai">
        <span className="wb-msg-label">AI</span>
        <span className="wb-msg-text">{message.text}</span>
      </div>
    )
  }
  return null
})

function stopWheel(e: React.WheelEvent) {
  e.stopPropagation()
}

function DockChatList({
  messages,
  chatOpen,
  setChatOpen,
}: {
  messages?: ChatMessage[]
  chatOpen: boolean
  setChatOpen: (v: boolean | ((c: boolean) => boolean)) => void
}) {
  const liveMessages = useStore($messages)
  const resolvedMessages = messages ?? liveMessages
  const chatMessages = useMemo(() => visibleCanvasMessages(resolvedMessages), [resolvedMessages])
  const lastMsg = chatMessages[chatMessages.length - 1]
  const lastMsgContent = lastMsg?.text ?? ''
  const scrollRef = useRef<HTMLDivElement>(null)
  const isStickToBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isStickToBottomRef.current = distanceToBottom < 48
  }, [])

  useLayoutEffect(() => {
    if (!chatOpen) return
    const el = scrollRef.current
    if (!el) return
    if (isStickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatMessages.length, lastMsgContent, chatOpen])

  return (
    <section className={`wb-section wb-chat${chatOpen ? '' : ' is-collapsed'}`} aria-label="普通聊天">
      <button
        type="button"
        className="wb-chat-head"
        onClick={() => setChatOpen((v) => !v)}
        aria-expanded={chatOpen}
      >
        <span className="wb-run-head-left">
          <span className="wb-head-chevron">{chatOpen ? '▾' : '▸'}</span>
          <span className="wb-head-title">对话协同</span>
        </span>
      </button>
      {chatOpen && (
        <div
          className="wb-convo-list scrollbar-dt nowheel"
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={stopWheel}
          role="log"
          aria-label="对话记录"
        >
          {chatMessages.length === 0 ? (
            <div className="wb-empty">
              <span className="wb-empty-title">还没有对话</span>
              <span className="wb-empty-hint">
                在画布下方描述流程或 Agent。
                <br />
                + 附项目文件，@ 引用路径。
              </span>
            </div>
          ) : (
            chatMessages.map((message, index) => (
              <MessageRow key={message.id || `${message.role}-${index}`} message={message} />
            ))
          )}
        </div>
      )}
    </section>
  )
}

export type WorkbenchDockProps = {
  /** 不传则自己订 $messages，避免画布父组件跟聊天流一起重绘 */
  messages?: ChatMessage[]
  dockOpen: boolean
  flowId: string
  runSteps: FlowRunStepLike[]
  replayOpen: boolean
  setReplayOpen: (v: boolean) => void
  onToggleDock: () => void
  onOpenDetails?: () => void
  onRerunFromMock?: (nodeId: string, mockOutput: unknown) => void
  /** 试跑参数（JSON 文本，按 start 节点字段生成模板） */
  testInput?: string
  onTestInputChange?: (v: string) => void
}

export const WorkbenchDock = memo(function WorkbenchDock({
  messages,
  dockOpen,
  flowId,
  runSteps,
  replayOpen,
  setReplayOpen,
  onToggleDock,
  onOpenDetails,
  onRerunFromMock,
  testInput,
  onTestInputChange,
}: WorkbenchDockProps) {
  const [runOpen, setRunOpen] = useState(runSteps.length > 0)
  const [chatOpen, setChatOpen] = useState(true)

  useEffect(() => {
    if (runSteps.length > 0) setRunOpen(true)
  }, [runSteps.length])
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)
  const [mockText, setMockText] = useState<string>('')
  const [editingMockId, setEditingMockId] = useState<string | null>(null)
  const completedCount = runSteps.filter((s) => s.status === 'completed').length
  const failed = runSteps.some((s) => s.status === 'failed')
  const running = runSteps.some((s) => s.status === 'running')
  const runStatus = failed ? '失败' : running ? '运行中' : runSteps.length > 0 ? '完成' : '待运行'

  if (!dockOpen) return null

  return (
    <aside
      className="wb-dock wb-unified-dock nowheel"
      aria-label="工作栏"
      onWheel={stopWheel}
    >
      <div className="wb-head">
        <div className="wb-head-main">
          <span className="wb-title">工作栏</span>
          <span className="wb-head-meta">运行状态 · 对话</span>
        </div>
        <button type="button" className="wb-close" onClick={onToggleDock} title="收起工作栏">
          ›
        </button>
      </div>

      <section className={`wb-section wb-run-panel${runOpen ? '' : ' is-collapsed'}`} aria-label="运行状态">
        <button
          type="button"
          className="wb-run-head"
          onClick={() => setRunOpen((v) => !v)}
          aria-expanded={runOpen}
        >
          <span className="wb-run-head-left">
            <span className="wb-head-chevron">{runOpen ? '▾' : '▸'}</span>
            <span className="wb-head-title">运行状态</span>
            <span className={`wb-run-status is-${failed ? 'failed' : running ? 'running' : completedCount > 0 ? 'completed' : 'pending'}`}>
              {runStatus}
            </span>
          </span>
          <span className="wb-run-head-right">
            {runSteps.length > 0 ? `${completedCount}/${runSteps.length} 步完成` : '尚无试跑'}
          </span>
        </button>
        {runOpen && (
          <div className="wb-run-body">
            <div className="wb-run-meta">
              <div className="wb-meta-left">
                <span className="wb-meta-label">流程</span>
                <span className="wb-meta-flow">/{flowId || '未命名'}</span>
              </div>
              {onOpenDetails && (
                <button type="button" className="wb-btn-inline" onClick={onOpenDetails}>
                  详情 ›
                </button>
              )}
            </div>
            {typeof testInput === 'string' && onTestInputChange && (
              <label className="wb-test-input-wrap">
                <span className="wb-meta-label">试跑参数（JSON，按起点字段生成模板）</span>
                <textarea
                  className="wb-test-input"
                  rows={3}
                  value={testInput}
                  onChange={(e) => onTestInputChange(e.target.value)}
                  placeholder='{"phoneNumber":"13800138000"}'
                  spellCheck={false}
                />
                <span className="wb-meta-hint">
                  节点内用 <code>{'{{input.字段名}}'}</code> 引用；留空传空对象。
                </span>
              </label>
            )}
            {runSteps.length > 0 ? (
              <div className="wb-run-steps-wrap">
                <button
                  type="button"
                  className="wb-replay-toggle"
                  onClick={() => setReplayOpen(!replayOpen)}
                >
                  <span>{replayOpen ? '▾' : '▸'} 执行链路与时空快照 ({completedCount}/{runSteps.length})</span>
                </button>
                {replayOpen && (
                  <div className="wb-replay-steps scrollbar-dt">
                    {runSteps.map((s) => {
                      const isExpanded = expandedStepId === s.nodeId
                      const isEditingMock = editingMockId === s.nodeId
                      const outputStr = s.output ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)) : ''
                      return (
                        <div key={s.nodeId} className={`wb-replay-step-card is-${s.status}`}>
                          <div
                            className={`wb-replay-step is-${s.status}`}
                            onClick={() => setExpandedStepId(isExpanded ? null : s.nodeId)}
                            style={{ cursor: 'pointer' }}
                          >
                            <span className="wb-replay-dot" />
                            <strong>{s.label}</strong>
                            <span className="wb-replay-badge">{s.status}</span>
                            <span className="wb-step-chevron">{isExpanded ? '▴' : '▾'}</span>
                          </div>
                          {isExpanded && (
                            <div className="wb-step-snapshot">
                              {isEditingMock ? (
                                <div className="wb-mock-editor">
                                  <div className="wb-mock-label">✏️ 编辑此步产物 (Mock Output JSON)</div>
                                  <textarea
                                    rows={4}
                                    className="wb-mock-textarea"
                                    value={mockText}
                                    onChange={(e) => setMockText(e.target.value)}
                                  />
                                  <div className="wb-mock-actions">
                                    <button
                                      type="button"
                                      className="wb-btn-inline primary"
                                      onClick={() => {
                                        try {
                                          const parsed = mockText.trim() ? JSON.parse(mockText) : mockText
                                          onRerunFromMock?.(s.nodeId, parsed)
                                          setEditingMockId(null)
                                        } catch {
                                          alert('Mock 文本不是合法 JSON')
                                        }
                                      }}
                                    >
                                      ▶ 注入 Mock 并向下重跑
                                    </button>
                                    <button
                                      type="button"
                                      className="wb-btn-inline"
                                      onClick={() => setEditingMockId(null)}
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="wb-snapshot-view">
                                  <pre className="wb-snapshot-pre">{outputStr || '(无返回值或待执行)'}</pre>
                                  {s.status === 'completed' && onRerunFromMock && (
                                    <div className="wb-snapshot-actions">
                                      <button
                                        type="button"
                                        className="wb-btn-inline"
                                        onClick={() => {
                                          setMockText(outputStr || '{\n  \n}')
                                          setEditingMockId(s.nodeId)
                                        }}
                                      >
                                        ✏️ Mock 产物并重跑
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <DockChatList messages={messages} chatOpen={chatOpen} setChatOpen={setChatOpen} />
    </aside>
  )
})
