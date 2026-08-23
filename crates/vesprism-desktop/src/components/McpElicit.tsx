/**
 * MCP 征求弹层（官方 x.ai/mcp/elicit）：表单或 URL 同意。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { McpElicitRequest } from '../types'
import { $activeTabId, patchActiveTab, patchTab } from '../store'
import { respondUserQuestion } from '../bridge'
import {
  checkElicitUrl,
  collectElicitContent,
  defaultValue,
  parseElicitSchema,
  type ElicitFieldValue,
} from '../lib/mcpElicit'

interface Props {
  request: McpElicitRequest | null
}

export function McpElicitPanel({ request }: Props) {
  const schema = useMemo(
    () => parseElicitSchema(request?.requestedSchema ?? { type: 'object', properties: {} }),
    [request?.requestId, request?.requestedSchema],
  )
  const [values, setValues] = useState<ElicitFieldValue[]>([])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setValues(schema.fields.map(defaultValue))
    setBusy(false)
    setErrors({})
  }, [request?.requestId])

  const urlInfo = useMemo(() => {
    if (!request || request.mode !== 'url' || !request.url) return null
    return checkElicitUrl(request.url)
  }, [request])

  const send = useCallback(
    async (payload: { outcome: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => {
      if (!request || busy) return
      setBusy(true)
      const tabId = $activeTabId.get()
      try {
        await respondUserQuestion(tabId, request.requestId, JSON.stringify(payload))
      } catch (e) {
        patchActiveTab({ error: String(e) })
        setBusy(false)
        return
      }
      if (payload.outcome === 'accept' && request.mode === 'url') {
        patchTab(tabId, { mcpElicit: { ...request, waiting: true } })
      } else {
        patchTab(tabId, { mcpElicit: null })
      }
      setBusy(false)
    },
    [request, busy],
  )

  const onAcceptForm = useCallback(() => {
    if (!request) return
    const { content, errors: next } = collectElicitContent(schema.fields, values)
    setErrors(next)
    if (Object.keys(next).length) return
    void send({ outcome: 'accept', content })
  }, [request, schema.fields, values, send])

  const onAcceptUrl = useCallback(() => {
    if (!request || !urlInfo || 'error' in urlInfo) return
    window.open(urlInfo.url, '_blank', 'noopener,noreferrer')
    void send({ outcome: 'accept' })
  }, [request, urlInfo, send])

  const onReopen = useCallback(() => {
    if (!urlInfo || 'error' in urlInfo) return
    window.open(urlInfo.url, '_blank', 'noopener,noreferrer')
  }, [urlInfo])

  const onDoneWaiting = useCallback(() => {
    const tabId = $activeTabId.get()
    patchTab(tabId, { mcpElicit: null })
  }, [])

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (request.waiting) onDoneWaiting()
      else void send({ outcome: 'cancel' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, send, onDoneWaiting])

  if (!request) return null

  const waiting = Boolean(request.waiting)
  const isUrl = request.mode === 'url'

  return (
    <div className="elicit-dock" role="dialog" aria-label="MCP 征求" aria-modal="false">
      <div className="elicit-card">
        <div className="elicit-head">
          <span className="elicit-badge">MCP</span>
          <span className="elicit-server" title={request.serverName}>
            {request.serverName || 'MCP 服务器'}
          </span>
          <button
            type="button"
            className="elicit-close"
            aria-label={waiting ? '完成' : '取消'}
            onClick={() => (waiting ? onDoneWaiting() : void send({ outcome: 'cancel' }))}
          >
            ×
          </button>
        </div>
        {request.message ? <p className="elicit-msg">{request.message}</p> : null}

        {waiting ? (
          <>
            <p className="elicit-wait">已同意，等服务器完成…</p>
            <div className="elicit-actions">
              <button type="button" className="elicit-act" onClick={onReopen}>
                再打开链接
              </button>
              <button type="button" className="elicit-act elicit-act-run" onClick={onDoneWaiting}>
                完成
              </button>
            </div>
          </>
        ) : isUrl ? (
          <>
            {urlInfo && 'error' in urlInfo ? (
              <p className="elicit-error">{urlInfo.error}</p>
            ) : urlInfo && 'url' in urlInfo ? (
              <div className="elicit-url">
                <div className="elicit-host">
                  {urlInfo.host}
                  {urlInfo.punycode ? <span className="elicit-warn"> 国际域名</span> : null}
                </div>
                <div className="elicit-url-full">{urlInfo.url}</div>
              </div>
            ) : null}
            <div className="elicit-actions">
              <button type="button" className="elicit-act" disabled={busy} onClick={() => void send({ outcome: 'decline' })}>
                拒绝
              </button>
              <button
                type="button"
                className="elicit-act elicit-act-run"
                disabled={busy || !urlInfo || 'error' in urlInfo}
                onClick={onAcceptUrl}
              >
                打开并同意
              </button>
            </div>
          </>
        ) : (
          <>
            {schema.error ? <p className="elicit-error">{schema.error}</p> : null}
            <div className="elicit-fields">
              {schema.fields.map((f, i) => {
                const v = values[i] || defaultValue(f)
                const err = errors[f.name]
                return (
                  <label key={f.name} className="elicit-field">
                    <span>
                      {f.title}
                      {f.required ? ' *' : ''}
                    </span>
                    {f.description ? <span className="elicit-desc">{f.description}</span> : null}
                    {f.kind === 'boolean' && v.kind === 'bool' ? (
                      <input
                        type="checkbox"
                        checked={v.on}
                        onChange={(e) =>
                          setValues((prev) => {
                            const next = [...prev]
                            next[i] = { kind: 'bool', on: e.target.checked }
                            return next
                          })
                        }
                      />
                    ) : f.kind === 'single' && v.kind === 'choice' ? (
                      <select
                        value={v.index ?? ''}
                        onChange={(e) =>
                          setValues((prev) => {
                            const next = [...prev]
                            next[i] = {
                              kind: 'choice',
                              index: e.target.value === '' ? null : Number(e.target.value),
                            }
                            return next
                          })
                        }
                      >
                        <option value="">请选择</option>
                        {(f.options ?? []).map((o, idx) => (
                          <option key={o.value} value={idx}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.kind === 'multi' && v.kind === 'multi' ? (
                      <div className="elicit-multi">
                        {(f.options ?? []).map((o, idx) => (
                          <label key={o.value}>
                            <input
                              type="checkbox"
                              checked={Boolean(v.selected[idx])}
                              onChange={() =>
                                setValues((prev) => {
                                  const next = [...prev]
                                  const cur = prev[i]
                                  const selected =
                                    cur && cur.kind === 'multi' ? [...cur.selected] : []
                                  selected[idx] = !selected[idx]
                                  next[i] = { kind: 'multi', selected }
                                  return next
                                })
                              }
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    ) : f.kind === 'unsupported' ? (
                      <span className="elicit-desc">不支持的字段（{f.reason}）</span>
                    ) : (
                      <input
                        type={f.format === 'email' ? 'email' : f.kind === 'number' || f.kind === 'integer' ? 'number' : 'text'}
                        value={v.kind === 'text' ? v.draft : ''}
                        onChange={(e) =>
                          setValues((prev) => {
                            const next = [...prev]
                            next[i] = { kind: 'text', draft: e.target.value }
                            return next
                          })
                        }
                      />
                    )}
                    {err ? <span className="elicit-error">{err}</span> : null}
                  </label>
                )
              })}
            </div>
            <div className="elicit-actions">
              <button type="button" className="elicit-act" disabled={busy} onClick={() => void send({ outcome: 'decline' })}>
                拒绝
              </button>
              <button type="button" className="elicit-act elicit-act-run" disabled={busy} onClick={onAcceptForm}>
                提交
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
