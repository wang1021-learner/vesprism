/**
 * 计划稿预览 / 审批卡：
 * 行号可选、行批注、批准 / 要改 / 复制 / 放弃（对齐官方 a/s/c/y/q）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import type { PlanComment } from '../types'
import {
  $activeTabId,
  $engineStatus,
  $lastPlanContent,
  $lastPlanHasBody,
  $lastPlanToolCallId,
  $messages,
  $planApproval,
  $planPreviewOpen,
  getTabState,
  patchActiveTab,
  patchTab,
  pushToast,
} from '../store'
import { respondExitPlanMode } from '../bridge'
import { generateId } from '../lib/generateId'
import {
  closePlanPreview,
  formatPlanFeedback,
  openPlanPreview,
  planPreviewBody,
} from '../lib/planMode'
import { applyTranscriptEvent } from '../lib/sessionTranscript'
import { sendSessionPrompt } from '../lib/sendSessionPrompt'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

function lineClass(line: string): string {
  const t = line.trimStart()
  if (t.startsWith('###')) return 'is-h3'
  if (t.startsWith('##')) return 'is-h2'
  if (t.startsWith('#')) return 'is-h1'
  if (t.startsWith('```')) return 'is-fence'
  if (t.startsWith('- ') || t.startsWith('* ') || t.startsWith('> ')) return 'is-list'
  return ''
}

function inRange(n: number, start: number, end: number): boolean {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  return n >= a && n <= b
}

export function PlanApprovalPanel() {
  const approval = useStore($planApproval)
  const lastContent = useStore($lastPlanContent)
  const lastHasBody = useStore($lastPlanHasBody)
  const lastToolId = useStore($lastPlanToolCallId)
  const generating = useStore($engineStatus) === 'generating'
  const [busy, setBusy] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [head, setHead] = useState<number | null>(null)
  const [comments, setComments] = useState<PlanComment[]>([])
  const [draft, setDraft] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [freeform, setFreeform] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const mac = useMemo(() => isMacPlatform(), [])

  const hasPlan = approval ? approval.hasPlan : lastHasBody
  const source = approval ? approval.planContent : lastContent
  const body = planPreviewBody(source, hasPlan)
  const lines = useMemo(() => body.split('\n'), [body])
  const toolCallId = approval?.toolCallId || lastToolId
  const canDecide = Boolean(approval)

  const selStart = anchor == null || head == null ? null : Math.min(anchor, head)
  const selEnd = anchor == null || head == null ? null : Math.max(anchor, head)

  useEffect(() => {
    setBusy(null)
    setAnchor(null)
    setHead(null)
    setComments([])
    setDraft('')
    setCommenting(false)
    setFreeform('')
    setEditingId(null)
  }, [approval?.requestId, toolCallId])

  useEffect(() => {
    if (commenting) commentRef.current?.focus()
  }, [commenting])

  const onPickLine = (n: number, shift: boolean) => {
    if (shift && anchor != null) {
      setHead(n)
      return
    }
    setAnchor(n)
    setHead(n)
    setCommenting(false)
    setDraft('')
    setEditingId(null)
  }

  const startComment = () => {
    if (selStart == null || selEnd == null) return
    setCommenting(true)
    setEditingId(null)
    setDraft('')
  }

  const saveComment = () => {
    const text = draft.trim()
    if (!text) return
    if (editingId) {
      setComments((prev) =>
        prev.map((c) => (c.id === editingId ? { ...c, text } : c)),
      )
    } else if (selStart != null && selEnd != null) {
      setComments((prev) => [
        ...prev,
        {
          id: generateId('pc_'),
          startLine: selStart,
          endLine: selEnd,
          text,
        },
      ])
    }
    setDraft('')
    setCommenting(false)
    setEditingId(null)
  }

  const respond = useCallback(
    async (outcome: 'approved' | 'cancelled' | 'abandoned', feedback?: string) => {
      if (!approval || busy) return
      setBusy(outcome)
      const tabId = $activeTabId.get()
      const payload: { outcome: string; feedback?: string } = { outcome }
      const fb = (feedback || '').trim()
      if (outcome === 'cancelled' && fb) payload.feedback = fb
      try {
        await respondExitPlanMode(tabId, approval.requestId, JSON.stringify(payload))
      } catch (e) {
        patchActiveTab({ error: String(e) })
        setBusy(null)
        return
      }
      const cur = getTabState(tabId)?.messages ?? $messages.get()
      const bgs = new Set(Object.keys(getTabState(tabId)?.backgroundTasks || {}))
      const next = applyTranscriptEvent(
        cur,
        {
          type: 'exit_plan_mode_resolved',
          tool_call_id: approval.toolCallId,
          outcome,
        },
        bgs,
      )
      patchTab(tabId, {
        messages: next,
        planApproval: null,
        planPreviewOpen: false,
        planPhase: outcome === 'cancelled' ? 'active' : 'off',
      })
      setBusy(null)
      if (outcome === 'approved' && fb) {
        const text = `The user approved the plan with the following review comments:\n\n${fb}`
        void sendSessionPrompt({
          text,
          mode: generating ? 'interject' : undefined,
        })
      }
    },
    [approval, busy, generating],
  )

  const onApprove = () => {
    const fb = formatPlanFeedback(comments, source, freeform)
    void respond('approved', fb)
  }

  const onRevise = () => {
    const fb = formatPlanFeedback(comments, source, freeform)
    if (!fb.trim()) {
      feedbackRef.current?.focus()
      return
    }
    void respond('cancelled', fb)
  }

  const onAbandon = () => void respond('abandoned')

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(body)
      pushToast('已复制计划稿', 'success')
    } catch {
      pushToast('复制失败', 'error')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (commenting) {
          e.preventDefault()
          setCommenting(false)
          setEditingId(null)
          setDraft('')
          return
        }
        if (document.activeElement === feedbackRef.current) {
          e.preventDefault()
          feedbackRef.current?.blur()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canDecide && !busy && !commenting) {
        e.preventDefault()
        onApprove()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const commentsByEnd = useMemo(() => {
    const map = new Map<number, PlanComment[]>()
    for (const c of comments) {
      const list = map.get(c.endLine) || []
      list.push(c)
      map.set(c.endLine, list)
    }
    return map
  }, [comments])

  const hasComments = comments.some((c) => c.text.trim())
  const approveLabel = hasComments ? '带批注批准' : '批准并动手'

  return (
    <div className="plan-dock" role="dialog" aria-label="计划稿">
      <div className="plan-card">
        <div className="plan-head">
          <span className="plan-badge">{canDecide ? '计划稿待批' : '计划稿'}</span>
          <span className="plan-head-title">plan.md</span>
          {!hasPlan ? <span className="plan-empty-tag">还没写</span> : null}
          <button type="button" className="plan-icon-btn" onClick={() => void onCopy()} title="复制全文">
            复制全文
          </button>
          {canDecide ? null : (
            <button
              type="button"
              className="plan-icon-btn"
              onClick={() => closePlanPreview()}
              title="关闭预览"
            >
              关闭
            </button>
          )}
        </div>

        <div className="plan-lines" role="list">
          {lines.map((line, i) => {
            const n = i + 1
            const selected = selStart != null && selEnd != null && inRange(n, selStart, selEnd)
            const rowComments = commentsByEnd.get(n) || []
            return (
              <div key={n} className="plan-line-block">
                <button
                  type="button"
                  role="listitem"
                  className={`plan-line${selected ? ' is-selected' : ''} ${lineClass(line)}`}
                  onClick={(e) => onPickLine(n, e.shiftKey)}
                >
                  <span className="plan-gutter">{n}</span>
                  <span className="plan-line-text">{line || ' '}</span>
                </button>
                {rowComments.map((c) => (
                  <div key={c.id} className="plan-comment">
                    <div className="plan-comment-meta">
                      {c.startLine === c.endLine
                        ? `第 ${c.startLine} 行`
                        : `第 ${c.startLine}–${c.endLine} 行`}
                      <button
                        type="button"
                        className="plan-comment-edit"
                        onClick={() => {
                          setEditingId(c.id)
                          setDraft(c.text)
                          setCommenting(true)
                          setAnchor(c.startLine)
                          setHead(c.endLine)
                        }}
                      >
                        改
                      </button>
                      <button
                        type="button"
                        className="plan-comment-edit"
                        onClick={() =>
                          setComments((prev) => prev.filter((x) => x.id !== c.id))
                        }
                      >
                        删
                      </button>
                    </div>
                    <div className="plan-comment-body">{c.text}</div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {canDecide && selStart != null && selEnd != null && !commenting ? (
          <div className="plan-select-bar">
            <span>
              已选 {selStart === selEnd ? `第 ${selStart} 行` : `第 ${selStart}–${selEnd} 行`}
            </span>
            <button type="button" className="plan-btn plan-btn-ghost" onClick={startComment}>
              批注
            </button>
          </div>
        ) : null}

        {canDecide && commenting ? (
          <div className="plan-comment-editor">
            <textarea
              ref={commentRef}
              className="plan-textarea"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="写给这几行的意见"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  saveComment()
                }
              }}
            />
            <div className="plan-comment-editor-actions">
              <button type="button" className="plan-btn plan-btn-ghost" onClick={() => {
                setCommenting(false)
                setEditingId(null)
                setDraft('')
              }}>
                取消
              </button>
              <button
                type="button"
                className="plan-btn plan-btn-primary"
                onClick={saveComment}
                disabled={!draft.trim()}
              >
                保存批注
              </button>
            </div>
          </div>
        ) : null}

        {canDecide ? (
          <>
            <label className="plan-freeform">
              <span className="plan-freeform-label">
                {hasComments ? `已有 ${comments.length} 条批注 · 还可写总意见` : '总意见（要改时必填；空回车不会批准）'}
              </span>
              <textarea
                ref={feedbackRef}
                className="plan-textarea"
                rows={2}
                value={freeform}
                onChange={(e) => setFreeform(e.target.value)}
                placeholder="认证别用 session cookie…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    onRevise()
                  }
                }}
                disabled={Boolean(busy)}
              />
            </label>
            <div className="plan-actions">
              <button
                type="button"
                className="plan-btn plan-btn-ghost plan-btn-danger"
                onClick={onAbandon}
                disabled={Boolean(busy)}
              >
                放弃
              </button>
              <div className="plan-actions-right">
                <button
                  type="button"
                  className="plan-btn plan-btn-ghost"
                  onClick={onRevise}
                  disabled={Boolean(busy)}
                >
                  发送要改
                </button>
                <button
                  type="button"
                  className="plan-btn plan-btn-primary"
                  onClick={onApprove}
                  disabled={Boolean(busy)}
                >
                  {busy ? '提交中…' : approveLabel}
                  <kbd className="plan-kbd">{mac ? '⌘⏎' : 'Ctrl⏎'}</kbd>
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function AppPlanApproval() {
  const open = useStore($planPreviewOpen)
  useEffect(() => {
    const onFocus = () => openPlanPreview()
    window.addEventListener('jike:focus-plan', onFocus)
    return () => window.removeEventListener('jike:focus-plan', onFocus)
  }, [])
  if (!open) return null
  return <PlanApprovalPanel />
}
