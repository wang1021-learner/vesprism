/**
 * 上下文 / 用量 / 会话 三页卡。点输入栏百分比或 /context /usage 打开。
 */
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $messages,
  $sessionInsightOpen,
  $sessionPhase,
  pushToast,
} from '../store'
import { sessionExt } from '../bridge'
import {
  contextBarParts,
  exportTranscriptMarkdown,
  formatDurationMs,
  formatTokens,
  formatUsdTicks,
  parseSessionInfo,
  parseSessionUsage,
  type SessionInfoView,
  type SessionUsageView,
} from '../lib/sessionInsight'
import { closeSessionInsight } from '../lib/engineSlash'

type Tab = 'context' | 'usage' | 'session'

export function SessionInsight() {
  const open = useStore($sessionInsightOpen)
  const tabId = useStore($activeTabId)
  const ready = useStore($sessionPhase) === 'ready'
  const [tab, setTab] = useState<Tab>('context')
  const [info, setInfo] = useState<SessionInfoView | null>(null)
  const [usage, setUsage] = useState<SessionUsageView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    if (!tabId || !ready) return
    setLoading(true)
    setError('')
    try {
      const [infoRaw, usageRaw] = await Promise.all([
        sessionExt(tabId, 'x.ai/session/info', {}),
        sessionExt(tabId, 'x.ai/session/usage', {}),
      ])
      setInfo(parseSessionInfo(infoRaw))
      setUsage(parseSessionUsage(usageRaw))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [tabId, ready])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSessionInsight()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const ctx = info?.context
  const bar = ctx ? contextBarParts(ctx) : null
  const near =
    ctx && ctx.autoCompactAt > 0 && ctx.usagePct >= Math.max(0, ctx.autoCompactAt - 10)

  const onCompact = async () => {
    if (!tabId || busy) return
    setBusy('compact')
    try {
      await sessionExt(tabId, 'x.ai/compact_conversation', {
        userContext: note.trim() || undefined,
      })
      pushToast('正在压缩上下文', 'success')
      setNote('')
      await load()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const onExport = async () => {
    const md = exportTranscriptMarkdown($messages.get())
    try {
      await navigator.clipboard.writeText(md)
      pushToast('已复制整份对话', 'success')
    } catch {
      pushToast('复制失败', 'error')
    }
  }

  return (
    <div className="insight-dock" role="dialog" aria-label="上下文与用量">
      <div className="insight-card">
        <div className="insight-head">
          <div className="insight-tabs" role="tablist">
            {(
              [
                ['context', '上下文'],
                ['usage', '用量'],
                ['session', '会话'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`insight-tab${tab === id ? ' is-on' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="insight-close"
            onClick={() => closeSessionInsight()}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {loading ? <p className="insight-status">读取中…</p> : null}
        {error ? <p className="insight-status is-error">{error}</p> : null}

        {tab === 'context' && ctx ? (
          <div className="insight-body">
            <div className="insight-hero">
              <strong>
                {formatTokens(ctx.used)} / {formatTokens(ctx.total)}
              </strong>
              <span>{ctx.usagePct}% · 自动压缩 {ctx.autoCompactAt}%</span>
            </div>
            {bar ? (
              <div
                className="insight-bar"
                role="img"
                aria-label={`系统提示 ${Math.round(bar.system)}%，消息 ${Math.round(bar.messages)}%，空闲 ${Math.round(bar.free)}%`}
              >
                <span className="is-system" style={{ width: `${bar.system}%` }} />
                <span className="is-messages" style={{ width: `${bar.messages}%` }} />
                <span className="is-free" style={{ width: `${bar.free}%` }} />
              </div>
            ) : null}
            <ul className="insight-legend">
              <li>
                <i className="is-system" /> 系统提示 {formatTokens(ctx.systemPromptTokens)}
              </li>
              <li>
                <i className="is-messages" /> 消息 {formatTokens(ctx.messageTokens)}
              </li>
              <li>
                <i className="is-free" /> 空闲 {formatTokens(ctx.freeTokens)}
              </li>
            </ul>
            {ctx.toolDefinitionsTokens > 0 ? (
              <p className="insight-meta">
                工具定义 {formatTokens(ctx.toolDefinitionsTokens)} · {ctx.toolDefinitionsCount} 个
              </p>
            ) : null}
            {ctx.categories.map((c) => (
              <p key={c.label} className="insight-meta">
                {c.label} {formatTokens(c.tokens)}
                {c.detail ? ` · ${c.detail}` : ''}
              </p>
            ))}
            <p className="insight-meta">
              {ctx.turnCount} 轮 · {ctx.toolCallCount} 次工具 · 压缩 {ctx.compactionCount} 次
            </p>
            {near ? (
              <p className="insight-warn">接近自动压缩阈值，可先手动压缩并留下要点。</p>
            ) : null}
            <label className="insight-note">
              <span>压缩时务必留下（可选）</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：保留认证方案"
              />
            </label>
            <div className="insight-actions">
              <button type="button" className="insight-btn" onClick={() => void onExport()}>
                导出对话
              </button>
              <button
                type="button"
                className="insight-btn is-primary"
                disabled={Boolean(busy) || !ready}
                onClick={() => void onCompact()}
              >
                {busy === 'compact' ? '压缩中…' : '压缩上下文'}
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'usage' && usage ? (
          <div className="insight-body">
            <div className="insight-hero">
              <strong>{formatTokens(usage.totals.totalTokens)}</strong>
              <span>
                {usage.totals.modelCalls} 次调用 · {formatUsdTicks(usage.totals.costUsdTicks, usage.totals.costIsPartial)}
              </span>
            </div>
            {usage.incomplete ? (
              <p className="insight-warn">记账可能不全（子任务还在跑或用量未结清）。</p>
            ) : null}
            <dl className="insight-dl">
              <div>
                <dt>输入</dt>
                <dd>
                  {formatTokens(usage.totals.inputTokens)}
                  {usage.totals.cachedReadTokens
                    ? `（缓存 ${formatTokens(usage.totals.cachedReadTokens)}）`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>
                  {formatTokens(usage.totals.outputTokens)}
                  {usage.totals.reasoningTokens
                    ? `（推理 ${formatTokens(usage.totals.reasoningTokens)}）`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>接口耗时</dt>
                <dd>{formatDurationMs(usage.totals.apiDurationMs)}</dd>
              </div>
            </dl>
            {usage.byModel.length > 1
              ? usage.byModel.map((m) => (
                  <p key={m.model} className="insight-meta">
                    {m.model} · 入 {formatTokens(m.inputTokens)} / 出 {formatTokens(m.outputTokens)}
                  </p>
                ))
              : null}
            <div className="insight-actions">
              <button type="button" className="insight-btn" onClick={() => void load()}>
                刷新
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'session' && info ? (
          <div className="insight-body">
            <dl className="insight-dl">
              <div>
                <dt>会话</dt>
                <dd className="is-mono" title={info.sessionId}>
                  {info.sessionId || '—'}
                </dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{info.modelDisplay || info.model || '—'}</dd>
              </div>
              <div>
                <dt>工作区</dt>
                <dd className="is-mono" title={info.cwd}>
                  {info.cwd || '—'}
                </dd>
              </div>
              <div>
                <dt>轮次</dt>
                <dd>
                  {info.turns}
                  {info.turnIndex ? ` · 当前第 ${info.turnIndex + 1}` : ''}
                </dd>
              </div>
              {info.agentName ? (
                <div>
                  <dt>Agent</dt>
                  <dd>{info.agentName}</dd>
                </div>
              ) : null}
            </dl>
            <div className="insight-actions">
              <button
                type="button"
                className="insight-btn"
                onClick={() => {
                  if (info.sessionId) {
                    void navigator.clipboard.writeText(info.sessionId)
                    pushToast('已复制会话 id', 'success')
                  }
                }}
              >
                复制会话 id
              </button>
              <button type="button" className="insight-btn is-primary" onClick={() => void onExport()}>
                导出对话
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !error && !info && !usage ? (
          <p className="insight-status">会话还没就绪。</p>
        ) : null}
      </div>
    </div>
  )
}
