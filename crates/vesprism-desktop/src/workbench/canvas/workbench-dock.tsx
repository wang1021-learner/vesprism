/**
 * 试跑浮层与对话记录。改图输入在画布底部浮动卡片。
 */
import { useStore } from '@nanostores/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageItem } from '../../components/Chat/MessageItem'
import { canRecallUser, canRetryAssistant } from '../../lib/userMessage'
import { $generating, $messages } from '../../store'
import type { ChatMessage } from '../../types'
import { visibleCanvasMessages } from './visibleMessages'

type FlowRunStepLike = {
  nodeId: string
  label: string
  status: string
  output?: unknown
}

function stopWheel(e: React.WheelEvent) {
  e.stopPropagation()
}

function focusUserQuestion(toolCallId: string) {
  window.dispatchEvent(new CustomEvent('jike:focus-user-question', { detail: { toolCallId } }))
}

function focusPlan(toolCallId: string) {
  window.dispatchEvent(new CustomEvent('jike:focus-plan', { detail: { toolCallId } }))
}

export function CanvasTalkLog({
  messages,
  limit,
  fadedTop,
}: {
  messages?: ChatMessage[]
  /** 只渲染最近 N 条；不传则全文。 */
  limit?: number
  fadedTop?: boolean
}) {
  const liveMessages = useStore($messages)
  const generating = useStore($generating)
  const resolvedMessages = messages ?? liveMessages
  const chatMessages = useMemo(() => {
    const all = visibleCanvasMessages(resolvedMessages)
    if (typeof limit === 'number' && limit >= 0) return all.slice(-limit)
    return all
  }, [resolvedMessages, limit])
  const lastMsg = chatMessages[chatMessages.length - 1]
  const lastMsgContent = lastMsg?.text ?? ''
  const lastIdx = chatMessages.length - 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const isStickToBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isStickToBottomRef.current = distanceToBottom < 48
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isStickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatMessages.length, lastMsgContent])

  return (
    <div
      className={`flow-talk-log messages-container scrollbar-dt nowheel${fadedTop ? ' is-clipped' : ''}`}
      ref={scrollRef}
      onScroll={handleScroll}
      onWheel={stopWheel}
      role="log"
      aria-label="对话记录"
    >
      {chatMessages.length === 0 ? (
        <div className="wb-empty">
          <span className="wb-empty-title">还没有对话</span>
          <span className="wb-empty-hint">描述流程，或说要改哪一步。</span>
        </div>
      ) : (
        chatMessages.map((message, index) => {
          const isLive =
            Boolean(message.isStreaming) ||
            (generating &&
              index === lastIdx &&
              (message.role === 'thought' || message.role === 'assistant'))
          return (
            <MessageItem
              key={message.id || `${message.role}-${index}`}
              message={message}
              streaming={isLive}
              sessionBusy={generating}
              canRetry={
                message.role === 'assistant' &&
                canRetryAssistant(resolvedMessages, message.id, generating)
              }
              canRecall={
                message.role === 'user' &&
                canRecallUser(resolvedMessages, message.id, generating)
              }
              onFocusUserQuestion={focusUserQuestion}
              onFocusPlan={focusPlan}
            />
          )
        })
      )}
    </div>
  )
}

export type WorkbenchDockProps = {
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
  const [runOpen, setRunOpen] = useState(true)

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

  if (!dockOpen && runSteps.length === 0) return null

  return (
    <aside
      className="wb-run-overlay nowheel"
      aria-label="试跑状态"
      onWheel={stopWheel}
    >
      <div className="wb-head">
        <div className="wb-head-main">
          <span className="wb-title">试跑</span>
          <span className="wb-head-meta">运行状态</span>
        </div>
        <button type="button" className="wb-close" onClick={onToggleDock} title="收起试跑">
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

    </aside>
  )
})
