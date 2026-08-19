/**
 * 画布工作栏：同一个会话区里收纳运行状态、对话记录和发送动作。
 */
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { $messages } from '../../store'
import type { ChatMessage } from '../../types'
import { visibleCanvasMessages } from './visibleMessages'
import { CanvasComposer } from './CanvasComposer'

type FlowRunStepLike = {
  nodeId: string
  label: string
  status: string
  output?: unknown
}

function isRunMsg(text: string): boolean {
  return /^\//.test(text.trim())
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    const isRun = isRunMsg(message.text)
    return (
      <div className={`wb-msg is-user${isRun ? ' is-run' : ''}`}>
        <span className="wb-msg-label">{isRun ? '试跑' : '你'}</span>
        <span className="wb-msg-text">{isRun ? message.text.trim().split('\n')[0] : message.text}</span>
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
}

export type WorkbenchDockProps = {
  /** 不传则自己订 $messages，避免画布父组件跟聊天流一起重绘 */
  messages?: ChatMessage[]
  dockOpen: boolean
  flowId: string
  flowName: string
  nodeIds?: string[]
  runSteps: FlowRunStepLike[]
  replayOpen: boolean
  setReplayOpen: (v: boolean) => void
  onToggleDock: () => void
  onRun: () => void
  onOpenDetails?: () => void
  onRetryStrict?: () => void
  onRerunFromMock?: (nodeId: string, mockOutput: unknown) => void
  error: string
}

export function WorkbenchDock({
  messages,
  dockOpen,
  flowId,
  flowName,
  nodeIds,
  runSteps,
  replayOpen,
  setReplayOpen,
  onToggleDock,
  onRun,
  onOpenDetails,
  onRetryStrict,
  onRerunFromMock,
  error,
}: WorkbenchDockProps) {
  const liveMessages = useStore($messages)
  const resolvedMessages = messages ?? liveMessages
  const [runOpen, setRunOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)
  const [mockText, setMockText] = useState<string>('')
  const [editingMockId, setEditingMockId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const completedCount = runSteps.filter((s) => s.status === 'completed').length
  const failed = runSteps.some((s) => s.status === 'failed')
  const running = runSteps.some((s) => s.status === 'running')
  const runStatus = failed ? '失败' : running ? '运行中' : runSteps.length > 0 ? '完成' : '待运行'
  const chatMessages = useMemo(() => visibleCanvasMessages(resolvedMessages), [resolvedMessages])

  useEffect(() => {
    if (!dockOpen || !chatOpen) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, dockOpen, chatOpen])

  if (!dockOpen) return null

  return (
    <aside className="wb-dock wb-unified-dock" aria-label="工作栏">
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
                <span className="wb-meta-label">流程：</span>
                <span className="wb-meta-flow">/{flowId || '未命名'}</span>
              </div>
              {onOpenDetails && (
                <button type="button" className="wb-btn-inline" onClick={onOpenDetails}>
                  详情 ›
                </button>
              )}
            </div>
            {runSteps.length > 0 ? (
              <div className="wb-run-steps-wrap">
                <button
                  type="button"
                  className="wb-replay-toggle"
                  onClick={() => setReplayOpen(!replayOpen)}
                >
                  <span>{replayOpen ? '▾' : '▸'} 执行链路与时空快照 ({completedCount}/${runSteps.length})</span>
                </button>
                {replayOpen && (
                  <div className="wb-replay-steps">
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
            ) : (
              <div className="wb-run-empty">
                <span>尚未开始试跑。点击顶部「▶ 试跑」即可验证当前流程。</span>
              </div>
            )}
          </div>
        )}
      </section>

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
          <div className="wb-convo-list scrollbar-dt" ref={scrollRef} role="log" aria-label="对话记录">
            {chatMessages.length === 0 ? (
              <p className="wb-empty">和主聊天一样：+ 附文件/文件夹，@ 引用路径。读完项目后会把流程画到画布上。</p>
            ) : (
              chatMessages.map((message, index) => (
                <MessageRow key={message.id || `${message.role}-${index}`} message={message} />
              ))
            )}
          </div>
        )}
      </section>

      <div className="wb-input-area">
        <CanvasComposer flowName={flowName} flowId={flowId} nodeIds={nodeIds} onRun={onRun} />
        {error ? (
          <div className="wb-err">
            <span>{error}</span>
            {onRetryStrict && (
              <button
                type="button"
                className="flow-btn primary"
                style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
                onClick={onRetryStrict}
              >
                ↺ 强制纯 JSON 重试
              </button>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
