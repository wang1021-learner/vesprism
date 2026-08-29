import { WORK_MODES } from '../framework/copy'
import type { WorkMode } from '../model/nodes'

export function ModeStrip({
  current,
  onJump,
}: {
  current: WorkMode
  onJump: (mode: WorkMode) => void
}) {
  return (
    <nav className="wd-modes" aria-label="四个工作面">
      {WORK_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`wd-mode${current === m.id ? ' is-on' : ''}`}
          aria-current={current === m.id ? 'page' : undefined}
          onClick={() => onJump(m.id)}
        >
          <span className="wd-mode-label">{m.label}</span>
          <span className="wd-mode-does">{m.does}</span>
        </button>
      ))}
    </nav>
  )
}
