/**
 * 对本会话发反馈（官方 x.ai/feedback）。
 * 空文本不发；失败展示引擎原文（经 formatEngineError）。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $feedbackOpen,
  closeFeedback,
  findNormalChatTab,
  getTabState,
  pushToast,
  switchTab,
} from '../store'
import { submitFeedback } from '../bridge'
import { formatEngineError } from '../lib/errorMessage'

export function FeedbackDialog() {
  const open = useStore($feedbackOpen)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) {
      setText('')
      setError('')
      setBusy(false)
      return
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) closeFeedback()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, busy])

  if (!open) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    let tabId = $activeTabId.get()
    const st = tabId ? getTabState(tabId) : null
    if (st?.utilityKind) {
      const chat = findNormalChatTab(false)
      if (!chat) {
        setError('先打开一场对话再发反馈')
        return
      }
      switchTab(chat)
      tabId = chat
    }
    if (!tabId) {
      setError('先打开一场对话再发反馈')
      return
    }
    setBusy(true)
    setError('')
    try {
      await submitFeedback(tabId, body)
      closeFeedback()
      pushToast('已记下你的反馈', 'success')
    } catch (err) {
      setError(formatEngineError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop rewind-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) closeFeedback()
      }}
    >
      <form
        className="modal-card rewind-card"
        role="dialog"
        aria-modal="true"
        aria-label="发送反馈"
        onSubmit={(e) => void submit(e)}
      >
        <div className="rewind-head">
          <h3>对本会话的意见</h3>
          <button
            type="button"
            className="rewind-close"
            aria-label="关闭"
            disabled={busy}
            onClick={closeFeedback}
          >
            ✕
          </button>
        </div>
        <p className="rewind-desc">
          发给官方反馈通道，不是发给模型。可写你觉得好用、难用或出错的地方。
        </p>
        <textarea
          ref={inputRef}
          className="feedback-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：审批弹得太勤 / 某次工具跑偏了…"
          rows={5}
          disabled={busy}
        />
        {error ? <div className="rewind-error">{error}</div> : null}
        <div className="rewind-actions">
          <button type="button" className="skills-btn" disabled={busy} onClick={closeFeedback}>
            取消
          </button>
          <button type="submit" className="skills-btn primary" disabled={busy || !text.trim()}>
            {busy ? '发送中…' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
