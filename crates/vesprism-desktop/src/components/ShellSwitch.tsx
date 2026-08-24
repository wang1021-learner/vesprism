import { useStore } from '@nanostores/react'
import { $appShell, setAppShell, type AppShell } from '../store'

const SHELLS: { id: AppShell; label: string }[] = [
  { id: 'coding', label: '编码' },
  { id: 'workbench', label: '工作台' },
]

/** 编码 / 工作台。侧栏左上角，纯文字 + 底线。 */
export function ShellSwitch() {
  const shell = useStore($appShell)
  return (
    <div className="shell-switch" role="tablist" aria-label="界面">
      {SHELLS.map((s) => (
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
