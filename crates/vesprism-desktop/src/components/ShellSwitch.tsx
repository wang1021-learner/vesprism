import { useStore } from '@nanostores/react'
import { listedProducts } from '../products/catalog'
import { $appShell, setAppShell } from '../store'

/** 产品切换。侧栏左上角，纯文字 + 底线。条目来自产品表。 */
export function ShellSwitch() {
  const shell = useStore($appShell)
  return (
    <div className="shell-switch" role="tablist" aria-label="界面">
      {listedProducts().map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={shell === s.id}
          className={`shell-switch-btn${shell === s.id ? ' is-active' : ''}`}
          onClick={() => setAppShell(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
