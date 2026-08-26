/**
 * AI 问卷浮层（输入栏上方灰卡）：
 * - 多题逐步作答；单选 / 多选
 * - Esc 取消；plan 模式：讨论 / 跳过
 * - 提交后工具卡回显所选答案
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  UserQuestionRequest,
  UserQuestionResponsePayload,
} from '../types'
import {
  $activeTabId,
  $messages,
  getTabState,
  patchActiveTab,
  patchTab,
} from '../store'
import { respondUserQuestion } from '../bridge'
import { formatEngineError } from '../lib/errorMessage'
import {
  applyTranscriptEvent,
  formatAskUserAnswerPreview,
} from '../lib/sessionTranscript'

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

  /** 收集全部已选题答案（提交用） */
  const collectAnswers = useCallback(() => {
    if (!request) {
      return {
        answers: {} as Record<string, string[]>,
        annotations: {} as Record<string, { notes?: string }>,
      }
    }
    const answers: Record<string, string[]> = {}
    const annotations: Record<string, { notes?: string }> = {}
    request.questions.forEach((q, i) => {
      const key = q.question
      if (q.multiSelect) {
        const set = multiSel[i]
        if (!set || set.size === 0) return
        answers[key] = [...set]
          .map((idx) => q.options[idx]?.label || '')
          .filter(Boolean)
      } else {
        const idx = singleSel[i]
        if (idx == null) return
        const label = q.options[idx]?.label || ''
        if (label) answers[key] = [label]
      }
      const notes = otherNotes[i]?.trim()
      if (notes) annotations[key] = { notes }
    })
    return { answers, annotations }
  }, [request, multiSel, singleSel, otherNotes])

  const submit = useCallback(
    async (payload: UserQuestionResponsePayload) => {
      if (!request || busy) return
      setBusy(true)
      const tabId = $activeTabId.get()
      const json = JSON.stringify(payload)
      try {
        await respondUserQuestion(tabId, request.requestId, json)
      } catch (e) {
        patchActiveTab({ error: formatEngineError(e) })
        setBusy(false)
        return
      }
      const answerPreview =
        payload.outcome === 'accepted' && 'answers' in payload
          ? formatAskUserAnswerPreview('accepted', payload.answers)
          : formatAskUserAnswerPreview(payload.outcome)
      const cur = getTabState(tabId)?.messages ?? $messages.get()
      const bgs = new Set(Object.keys(getTabState(tabId)?.backgroundTasks || {}))
      const next = applyTranscriptEvent(cur, {
        type: 'user_question_resolved',
        tool_call_id: request.toolCallId,
        outcome: payload.outcome,
        answer_preview: answerPreview,
      }, bgs)
      patchTab(tabId, { messages: next, userQuestion: null })
      setBusy(false)
    },
    [request, busy],
  )

  const onCancel = useCallback(() => {
    void submit({ outcome: 'cancelled' })
  }, [submit])

  const onAccept = useCallback(() => {
    if (!request || !canNext) return
    const { answers, annotations } = collectAnswers()
    // 最后一题通过 canNext；前面已逐步作答。至少要有一题答案
    if (Object.keys(answers).length === 0) return
    void submit({
      outcome: 'accepted',
      answers,
      annotations: Object.keys(annotations).length ? annotations : undefined,
    })
  }, [request, canNext, collectAnswers, submit])

  // Esc 取消；数字键 1–9 快选当前题
  useEffect(() => {
    if (!request || !current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const idx = n - 1
      if (idx >= current.options.length) return
      e.preventDefault()
      if (isMulti) {
        setMultiSel((prev) => {
          const next = { ...prev }
          const set = new Set(next[step] ?? [])
          if (set.has(idx)) set.delete(idx)
          else set.add(idx)
          next[step] = set
          return next
        })
      } else {
        setSingleSel((p) => ({ ...p, [step]: idx }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, current, isMulti, step, onCancel])

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
    <div
      className="uq-dock"
      role="dialog"
      aria-label="AI 问卷"
      aria-modal="false"
      id="user-question-panel"
    >
      <div className="uq-card">
        <div className="uq-head">
          <span className="uq-badge">问卷</span>
          <span className="uq-step">
            {step + 1} / {total}
            {isMulti ? ' · 可多选' : ''}
          </span>
          <button
            type="button"
            className="uq-close"
            onClick={onCancel}
            title="取消 (Esc)"
            aria-label="取消问卷"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <div className="uq-question" id={`uq-q-${step}`}>
          {current.question}
        </div>

        <div
          className="uq-options"
          role={isMulti ? 'group' : 'radiogroup'}
          aria-labelledby={`uq-q-${step}`}
        >
          {current.options.map((opt, i) => {
            const selected = isMulti
              ? Boolean(multiSel[step]?.has(i))
              : singleSel[step] === i
            return (
              <button
                key={`${opt.label}-${i}`}
                type="button"
                role={isMulti ? 'checkbox' : 'radio'}
                aria-checked={selected}
                className={`uq-option${selected ? ' is-selected' : ''}`}
                onClick={() => {
                  if (isMulti) toggleMulti(i)
                  else setSingleSel((p) => ({ ...p, [step]: i }))
                }}
                disabled={busy}
              >
                <span className="uq-option-mark" aria-hidden>
                  {isMulti ? (selected ? '☑' : '☐') : selected ? '●' : '○'}
                </span>
                <span className="uq-option-body">
                  <span className="uq-option-label">
                    {i < 9 ? (
                      <kbd className="uq-option-key">{i + 1}</kbd>
                    ) : null}
                    {/^other$/i.test(opt.label.trim()) ? '其他' : opt.label}
                  </span>
                  {opt.description ? (
                    <span className="uq-option-desc">{opt.description}</span>
                  ) : null}
                  {opt.preview && selected ? (
                    <pre className="uq-option-preview">{opt.preview}</pre>
                  ) : null}
                </span>
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
            placeholder="没有合适选项时，可以写在这里"
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
                {busy ? '提交中…' : '提交'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
