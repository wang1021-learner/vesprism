import { useState } from 'react'
import type { StationVerb } from '../framework/station'

/** 令签：主按钮 + 其他动作 + 一句约束。不做斜杠解析，输入只当这一句人话。 */
export function CommandDock({
  verbs,
  fallback,
  extraSeed,
  askReply,
  onClearAsk,
  onDispatch,
  busy,
  stat,
}: {
  verbs: StationVerb[]
  fallback: StationVerb
  extraSeed?: string
  askReply?: string | null
  onClearAsk?: () => void
  onDispatch: (verb: StationVerb, extra: string) => void
  /** 引擎生成中：禁用所有动作 */
  busy?: boolean
  stat?: string
}) {
  const [line, setLine] = useState(extraSeed ?? '')
  const others = verbs.filter((v) => v.id !== fallback.id && v.id !== 'ask')
  const ask = verbs.find((v) => v.id === 'ask')

  const fire = (verb: StationVerb) => {
    onDispatch(verb, line.trim())
  }

  return (
    <form
      className="wd-cmd"
      aria-label="这一步能做的"
      onSubmit={(e) => {
        e.preventDefault()
        fire(fallback)
      }}
    >
      <p className="wd-kicker">这一步能做的事{busy ? ' · 生成中…' : ''}{stat ? ` · ${stat}` : ''}</p>
      <button
        type="submit"
        className="wd-btn wd-btn-primary"
        disabled={busy || (!fallback.ok && fallback.id !== 'ask')}
        title={fallback.hint}
      >
        <span className="wd-btn-label">{fallback.label}</span>
        <span className="wd-btn-does">{fallback.does}</span>
      </button>
      {others.length ? (
        <div className="wd-cmd-chips" role="group" aria-label="其他动作">
          {others.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`wd-cmd-chip${!v.ok ? ' is-off' : ''}${v.kind === 'read' ? ' is-read' : ''}`}
              title={v.hint}
              disabled={busy || (!v.ok && v.id !== 'ask')}
              onClick={() => fire(v)}
            >
              {v.label}
              <span className="wd-btn-does">{v.does}</span>
            </button>
          ))}
        </div>
      ) : null}
      <label className="wd-cmd-box">
        <span className="wd-field-k">这一次只要 AI 记住的一句（可空，不是对话框）</span>
        <input
          className="wd-cmd-input"
          aria-label="一句约束，可空"
          value={line}
          disabled={busy}
          placeholder={fallback.hint}
          onChange={(e) => setLine(e.target.value)}
        />
      </label>
      <p className="wd-cmd-preview">
        {busy
          ? '引擎生成中…这一轮完自动回来'
          : `${fallback.kind === 'read' ? '只读 · ' : '将下达 · '}${fallback.label}${line.trim() ? ` · ${line.trim()}` : ' · 无额外约束'}${fallback.ok ? '' : ` · ${fallback.hint}`}`}
      </p>
      {ask ? (
        <button
          type="button"
          className="wd-cmd-chip is-read"
          title={ask.hint}
          disabled={busy}
          onClick={() => fire(ask)}
        >
          {ask.label}
          <span className="wd-btn-does">{ask.does}</span>
        </button>
      ) : null}
      {askReply ? (
        <aside className="wd-ask" aria-label="只读回答">
          <p className="wd-kicker">查设定 · 只读</p>
          <p>{askReply}</p>
          <button type="button" className="wd-btn wd-btn-ghost" onClick={onClearAsk}>
            收起
          </button>
        </aside>
      ) : null}
    </form>
  )
}
