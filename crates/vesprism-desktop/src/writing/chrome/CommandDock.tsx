import { useMemo, useState } from 'react'
import { commandHint, parseDeskCommand } from '../framework/command'
import type { StationVerb } from '../framework/station'

export function CommandDock({
  verbs,
  fallback,
  extraSeed,
  askReply,
  onClearAsk,
  onDispatch,
}: {
  verbs: StationVerb[]
  fallback: StationVerb
  extraSeed?: string
  askReply?: string | null
  onClearAsk?: () => void
  onDispatch: (verb: StationVerb, extra: string, beatNo?: number) => void
}) {
  const [line, setLine] = useState(extraSeed ?? '')
  const parsed = useMemo(() => parseDeskCommand(line, verbs, fallback), [line, verbs, fallback])
  const others = verbs.filter((v) => v.id !== fallback.id && v.id !== 'ask')
  const ask = verbs.find((v) => v.id === 'ask')

  const fire = (verb: StationVerb) => {
    const t = line.trim()
    if (t.startsWith('/')) {
      const p = parseDeskCommand(t, verbs, verb)
      if (p.verb.id === verb.id) onDispatch(verb, p.extra, p.beatNo)
      else onDispatch(verb, '')
      return
    }
    onDispatch(verb, t)
  }

  return (
    <form
      className="wd-cmd"
      aria-label="这一步能做的"
      onSubmit={(e) => {
        e.preventDefault()
        onDispatch(parsed.verb, parsed.extra, parsed.beatNo)
      }}
    >
      <p className="wd-kicker">这一步能做的事</p>
      <button
        type="submit"
        className="wd-btn wd-btn-primary"
        disabled={!fallback.ok && fallback.id !== 'ask'}
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
              className={`wd-cmd-chip${parsed.verb.id === v.id ? ' is-on' : ''}${!v.ok ? ' is-off' : ''}${v.kind === 'read' ? ' is-read' : ''}`}
              title={v.hint}
              disabled={!v.ok && v.id !== 'ask'}
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
          placeholder={commandHint(parsed.verb)}
          onChange={(e) => setLine(e.target.value)}
        />
      </label>
      <p className="wd-cmd-preview">
        {parsed.verb.kind === 'read' ? '只读 · ' : '将下达 · '}
        {parsed.verb.label}
        {parsed.beatNo ? ` · 切块${parsed.beatNo}` : ''}
        {parsed.extra ? ` · ${parsed.extra}` : ' · 无额外约束'}
        {parsed.verb.ok ? '' : ` · ${parsed.verb.hint}`}
      </p>
      {ask ? (
        <button
          type="button"
          className="wd-cmd-chip is-read"
          title={ask.hint}
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
