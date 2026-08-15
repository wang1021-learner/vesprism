import { useEffect, useRef } from 'react'
import { useStore } from '@nanostores/react'
import { $terminals } from '../store'
import { terminalOutcome, terminalStatusLabel } from '../lib/terminalCards'

/** 会话内命令输出卡：只读、不折叠、不限张数。超长砍头，三种结局分开。 */
export function TerminalList() {
  const terminals = useStore($terminals)
  const items = Object.values(terminals).sort((a, b) => a.openedAt - b.openedAt)
  if (items.length === 0) return null
  return (
    <div className="term-list" role="region" aria-label="命令输出">
      {items.map((t) => (
        <TerminalCard key={t.terminalId} term={t} />
      ))}
    </div>
  )
}

function TerminalCard({
  term,
}: {
  term: import('../types').TerminalRuntime
}) {
  const running = !term.exited
  const outcome = terminalOutcome(term)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!running) return
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [term.text, running])

  return (
    <div className={`term-card is-${outcome} is-expanded`}>
      <div className="term-head">
        <span className="term-dot" aria-hidden />
        <code className="term-command" title={term.command}>
          {term.command || '(命令)'}
        </code>
        <span className={`term-meta is-${outcome}`}>{terminalStatusLabel(term)}</span>
      </div>
      {term.truncated ? (
        <div className="term-trim" role="note">
          输出过长，仅保留末尾
        </div>
      ) : null}
      <pre ref={preRef} className="term-output">
        {term.text || ' '}
      </pre>
    </div>
  )
}
