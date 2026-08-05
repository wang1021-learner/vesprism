/**
 * AI 问卷浮层（gray card above composer）：
 * - 多题逐步作答
 * - Esc 取消
 * - plan 模式额外：讨论 / 跳过
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  UserQuestionRequest,
  UserQuestionResponsePayload,
} from '../types'
import { $activeTabId, patchActiveTab, patchTab, getTabState } from '../store'
import { respondUserQuestion } from '../bridge'
import {
  applyTranscriptEvent,
  formatAskUserAnswerPreview,
} from '../lib/sessionTranscript'
import { $messages } from '../store'

interface Props {
  request: UserQuestionRequest | null
  /** 工具行点击时聚焦到此面板 */
  focusKey?: number
}

export function UserQuestionPanel({ request, focusKey = 0 }: Props) {
  const [step, setStep] = useState(0)
  const [singleSel, setSingleSel] = useState<Record<number, number | null>>({})
  const [multiSel, setMultiSel] = useState<Record<number, Set<number>>>({})
  const [otherNotes, setOtherNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  // 新请求或 focus 时重置步骤
  useEffect(() => {
    setStep(0)
    setSingleSel({})
    setMultiSel({})
    setOtherNotes({})
    setBusy(false)
  }, [request?.requestId, request?.toolCallId, focusKey])

  const questions = request?.questions ?? []
  const total = questions.length
  const mode = (request?.mode || 'default').toLowerCase()
  const isPlan = mode === 'plan'
  const current = questions[step]
  const isMulti = Boolean(current?.multiSelect)

  const canNext = useMemo(() => {
    if (!current) return false
    if (isMulti) {
      const set = multiSel[step]
      return Boolean(set && set.size > 0)
    }
    return singleSel[step] != null
  }, [current, isMulti, multiSel, singleSel, step])

  const submit = useCallback(
    async (payload: UserQuestionResponsePayload) => {
      if (!request || busy) return
      setBusy(true)
      const tabId = $activeTabId.get()
      const json = JSON.stringify(payload)
      try {
        await respondUserQuestion(tabId, request.requestId, json)
      } catch (e) {
        patchActiveTab({ error: String(e) })
        setBusy(false)
        return
      }
      // 更新 transcript 工具卡 + 清问卷
      const cur = getTabState(tabId)?.messages ?? $messages.get()
      const next = applyTranscriptEvent(cur, {
        type: 'user_question_resolved',
        tool_call_id: request.toolCallId,
        outcome: payload.outcome,
        answer_preview: formatAskUserAnswerPreview(payload.outcome),
      })
      patchTab(tabId, { messages: next, userQuestion: null })
      setBusy(false)
    },
    [request, busy],
  )

  const onCancel = useCallback(() => {
    void submit({ outcome: 'cancelled' })
  }, [submit])

  const onAccept = useCallback(() => {
    if (!request) return
    const answers: Record<string, string[]> = {}
    const annotations: Record<string, { notes?: string }> = {}
    request.questions.forEach((q, i) => {
      const key = q.question
      if (q.multiSelect) {
        const set = multiSel[i]
        if (!set || set.size === 0) return
        answers[key] = [...set].map((idx) => q.options[idx]?.label || '').filter(Boolean)
      } else {
        const idx = singleSel[i]
        if (idx == null) return
        const label = q.options[idx]?.label || ''
        if (label) answers[key] = [label]
      }
      const notes = otherNotes[i]?.trim()
      if (notes) annotations[key] = { notes }
    })
    void submit({
      outcome: 'accepted',
      answers,
      annotations: Object.keys(annotations).length ? annotations : undefined,
    })
  }, [request, multiSel, singleSel, otherNotes, submit])

  // Esc 取消
  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, onCancel])

  if (!request || !current) return null

  const toggleMulti = (optIdx: number) => {
    setMultiSel((prev) => {
      const next = { ...prev }
      const set = new Set(next[step] ?? [])
      if (set.has(optIdx)) set.delete(optIdx)
      else set.add(optIdx)
      next[step] = set
      return next
    })
  }

  return (
    <div className="uq-dock" role="dialog" aria-label="AI 问卷" id="user-question-panel">
      <div className="uq-card">
        <div className="uq-head">
          <span className="uq-badge">Ask</span>
          <span className="uq-step">
            {step + 1} / {total}
          </span>
          <button
            type="button"
            className="uq-close"
            onClick={onCancel}
            title="取消 (Esc)"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <div className="uq-question">{current.question}</div>

        <div className="uq-options" role={isMulti ? 'group' : 'radiogroup'}>
          {current.options.map((opt, i) => {
            const selected = isMulti
              ? multiSel[step]?.has(i)
              : singleSel[step] === i
            return (
              <button
                key={`${opt.label}-${i}`}
                type="button"
                className={`uq-option${selected ? ' is-selected' : ''}`}
                onClick={() => {
                  if (isMulti) toggleMulti(i)
                  else setSingleSel((p) => ({ ...p, [step]: i }))
                }}
                disabled={busy}
              >
                <span className="uq-option-label">{opt.label}</span>
                {opt.description ? (
                  <span className="uq-option-desc">{opt.description}</span>
                ) : null}
                {opt.preview && selected ? (
                  <pre className="uq-option-preview">{opt.preview}</pre>
                ) : null}
              </button>
            )
          })}
        </div>

        <label className="uq-other">
          <span className="uq-other-label">补充说明（可选）</span>
          <input
            type="text"
            className="uq-other-input"
            value={otherNotes[step] ?? ''}
            onChange={(e) =>
              setOtherNotes((p) => ({ ...p, [step]: e.target.value }))
            }
            placeholder="Other / 备注"
            disabled={busy}
          />
        </label>

        <div className="uq-actions">
          {step > 0 ? (
            <button
              type="button"
              className="uq-btn uq-btn-ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={busy}
            >
              上一题
            </button>
          ) : (
            <span />
          )}
          <div className="uq-actions-right">
            {isPlan ? (
              <>
                <button
                  type="button"
                  className="uq-btn uq-btn-ghost"
                  onClick={() => void submit({ outcome: 'chat_about_this' })}
                  disabled={busy}
                >
                  讨论
                </button>
                <button
                  type="button"
                  className="uq-btn uq-btn-ghost"
                  onClick={() => void submit({ outcome: 'skip_interview' })}
                  disabled={busy}
                >
                  跳过
                </button>
              </>
            ) : null}
            {step < total - 1 ? (
              <button
                type="button"
                className="uq-btn uq-btn-primary"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext || busy}
              >
                下一题
              </button>
            ) : (
              <button
                type="button"
                className="uq-btn uq-btn-primary"
                onClick={onAccept}
                disabled={!canNext || busy}
              >
                提交
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
