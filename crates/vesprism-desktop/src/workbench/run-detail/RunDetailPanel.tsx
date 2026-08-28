import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $recentWorkflows, clearRecentWorkflows, collectAllTabSubagents } from '../../store'
import { SubagentRunTree } from '../../components/SubagentRunTree'
import { workflowStatusLabel } from '../../lib/workflowCards'
import { getSessionMessages } from '../../bridge'
import { mapDisplayMessages } from '../../lib/openSubagentTab'
import { generateId } from '../../lib/generateId'
import type { ChatMessage } from '../../types'
import type { MemberRow } from '../../lib/subagentRunTree'

type ChatView = {
  label: string
  sessionId: string
  output?: string
}

function roleLabel(role: ChatMessage['role']): string {
  switch (role) {
    case 'user':
      return '用户'
    case 'assistant':
      return '助手'
    case 'thought':
      return '思考'
    case 'tool':
      return '工具'
    default:
      return '系统'
  }
}

function withOutputFallback(messages: ChatMessage[], output?: string): ChatMessage[] {
  const fallback = (output || '').trim()
  if (!fallback) return messages
  const hasAssistant = messages.some((m) => m.role === 'assistant' && m.text.trim())
  if (hasAssistant) return messages
  return [...messages, { id: generateId('msg_'), role: 'assistant', text: fallback }]
}

export default function RunDetailPanel() {
  const recent = useStore($recentWorkflows)
  const runs = useMemo(() => Object.values(recent).reverse(), [recent])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null
  const subagents = useMemo(() => collectAllTabSubagents(), [recent, selectedRunId])

  const [chat, setChat] = useState<ChatView | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')

  const openConversation = useCallback(async (m: MemberRow) => {
    const sessionId = (m.childSessionId || m.agentId || '').trim()
    setChat({ label: m.label, sessionId, output: m.output })
    setChatError('')
    setChatMessages(m.output ? withOutputFallback([], m.output) : [])
    if (!sessionId) {
      if (!m.output) setChatError('没有可查看的对话')
      return
    }
    setChatLoading(true)
    try {
      const raw = await getSessionMessages(sessionId)
      setChatMessages(withOutputFallback(mapDisplayMessages(raw), m.output))
    } catch (e) {
      if (!m.output) setChatError(`加载对话失败：${String(e)}`)
    } finally {
      setChatLoading(false)
    }
  }, [])

  if (runs.length === 0) {
    return (
      <div className="run-detail-panel">
        <div className="run-detail-empty">
          还没有试跑记录。在流程画布点「▶ 试跑」后，这里会展示完整的运行详情（支持跨会话持久化）。
        </div>
      </div>
    )
  }

  const completed = (selected?.agents ?? []).filter((a) => a.state === 'done').length
  const total = selected?.agents?.length ?? 0

  if (chat) {
    return (
      <div className="run-detail-panel" role="region" aria-label="试跑对话">
        <header className="run-detail-head">
          <div className="run-detail-title">
            <button
              type="button"
              className="run-detail-back-btn"
              onClick={() => {
                setChat(null)
                setChatMessages([])
                setChatError('')
              }}
            >
              ← 返回
            </button>
            <span className="run-detail-title-label">对话</span>
            <span className="run-detail-chat-agent" title={chat.label}>
              {chat.label}
            </span>
          </div>
        </header>
        <div className="run-detail-chat-log scrollbar-dt" role="log">
          {chatLoading && chatMessages.length === 0 ? (
            <div className="run-detail-empty">正在加载对话…</div>
          ) : chatError && chatMessages.length === 0 ? (
            <div className="run-detail-empty">{chatError}</div>
          ) : chatMessages.length === 0 ? (
            <div className="run-detail-empty">没有对话记录</div>
          ) : (
            chatMessages.map((m) => (
              <article key={m.id} className={`run-detail-bubble is-${m.role}`}>
                <span className="run-detail-bubble-role">{roleLabel(m.role)}</span>
                <pre className="run-detail-bubble-text">{m.text || m.toolCall?.preview || m.tool || '（空）'}</pre>
              </article>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="run-detail-panel" role="region" aria-label="试跑详情">
      <header className="run-detail-head">
        <div className="run-detail-title">
          <span className="run-detail-title-label">试跑详情</span>
          <select
            className="run-detail-select"
            value={selected.runId}
            aria-label="切换运行"
            onChange={(e) => setSelectedRunId(e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.name} · {workflowStatusLabel(r.status)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="run-detail-clear-btn"
            title="清空全部历史试跑记录"
            onClick={() => {
              if (window.confirm('确认清空所有历史试跑记录？')) {
                clearRecentWorkflows()
                setSelectedRunId(null)
              }
            }}
          >
            清空历史
          </button>
        </div>
        <span className={`run-detail-status is-${selected.status}`}>
          {workflowStatusLabel(selected.status)}
        </span>
      </header>

      <div className="run-detail-overview">
        <div className="run-detail-ov-item">
          <span className="run-detail-ov-label">流程</span>
          <span className="run-detail-ov-value">{selected.name || selected.runId}</span>
        </div>
        <div className="run-detail-ov-item">
          <span className="run-detail-ov-label">子代理</span>
          <span className="run-detail-ov-value">
            {total > 0 ? `${completed}/${total} 完成` : '—'}
          </span>
        </div>
        <div className="run-detail-ov-item">
          <span className="run-detail-ov-label">目标</span>
          <span className="run-detail-ov-value">{selected.objective || '—'}</span>
        </div>
      </div>

      <div className="run-detail-tree scrollbar-dt">
        <SubagentRunTree
          workflows={selected ? [selected] : []}
          subagents={subagents}
          readonly
          onViewConversation={(m) => void openConversation(m)}
        />
      </div>
    </div>
  )
}
