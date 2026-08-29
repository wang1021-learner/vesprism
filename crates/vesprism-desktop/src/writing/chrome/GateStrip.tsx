import type { Gate } from '../model/types'

export function GateStrip({ gates }: { gates: Gate[] }) {
  if (!gates.length) return null
  return (
    <div className="wd-gates" role="status" aria-live="polite">
      <ul className="wd-gate-list">
        {gates.map((g) => (
          <li key={g.id} className={g.ok ? 'is-ok' : 'is-block'}>
            <span className="wd-gate-from">{g.from}</span>
            <span className="wd-gate-arrow" aria-hidden>
              →
            </span>
            <span>{g.to}</span>
            <span className="wd-gate-need">{g.ok ? '过了' : g.need}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
