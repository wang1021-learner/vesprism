import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $recentWorkflows,
  $subagentRevision,
  clearRecentWorkflows,
  collectAllTabSubagents,
} from '../../store'
import { SubagentRunTree } from '../../components/SubagentRunTree'
import { workflowStatusLabel } from '../../lib/workflowCards'
import { getSessionMessages } from '../../bridge'
import { generateId } from '../../lib/generateId'
import type { ChatMessage } from '../../types'
import type { MemberRow } from '../../lib/subagentRunTree'
import { conversationSessionIds, loadRunConversation } from './loadConversation'

type ChatView = {
  label: string
  ids: string[]
  output?: string
  memberKey: string
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

function memberKeyOf(m: MemberRow): string {
  return `${m.agentId}\0${m.childSessionId || ''}`
}

function bubbleText(m: ChatMessage): string {
  return m.text || m.toolCall?.preview || m.toolCall?.detail || m.tool || '（空）'
}

export default function RunDetailPanel() {
  const recent = useStore($recentWorkflows)
  const subRev = useStore($subagentRevision)
  const runs = useMemo(() => Object.values(recent).reverse(), [recent])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null
  const subagents = useMemo(
    () => collectAllTabSubagents(),
    [recent, selectedRunId, subRev],
  )

  const [chat, setChat] = useState<ChatView | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatGen = useRef(0)

  const refreshChat = useCallback(async (view: ChatView) => {
    const gen = ++chatGen.current
    const result = await loadRunConversation(view.ids, view.output, getSessionMessages)
    if (gen !== chatGen.current) return
    setChatMessages(result.messages)
    setChatError(result.error)
    setChatLoading(false)
  }, [])

  const openConversation = useCallback(
    (m: MemberRow) => {
      const ids = conversationSessionIds(m)
      const view: ChatView = {
        label: m.label,
        ids,
        output: m.output,
        memberKey: memberKeyOf(m),
      }
      chatGen.current += 1
      setChat(view)
      setChatError('')
      setChatMessages(
        m.output ? [{ id: generateId('msg_'), role: 'assistant', text: m.output }] : [],
      )
      if (ids.length === 0 && !m.output) {
        setChatLoading(false)
        setChatError('没有可查看的对话')
        return
      }
      setChatLoading(true)
      void refreshChat(view)
    },
    [refreshChat],
  )

  useEffect(() => {
    if (!chat || (chat.ids.length === 0 && !chat.output)) return
    void refreshChat(chat)
    const t = window.setInterval(() => {
      void refreshChat(chat)
    }, 1500)
    return () => window.clearInterval(t)
  }, [chat, subRev, refreshChat])

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
                chatGen.current += 1
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
            <div className="run-detail-empty">没有对话记录。子代理可能还在写盘，稍等会自动刷新。</div>
          ) : (
            chatMessages.map((m) => (
              <article key={m.id} className={`run-detail-bubble is-${m.role}`}>
                <span className="run-detail-bubble-role">{roleLabel(m.role)}</span>
                <pre className="run-detail-bubble-text">{bubbleText(m)}</pre>
              </article>
            ))
          )}
          {chatError && chatMessages.length > 0 ? (
            <div className="run-detail-chat-note">{chatError}</div>
          ) : null}
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
            {total > 0 ? `${completed}/${total} 完成` : subagents.length > 0 ? `${subagents.length} 个` : '—'}
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
          onViewConversation={openConversation}
        />
      </div>
    </div>
  )
}
