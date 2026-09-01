import { useStore } from '@nanostores/react'
import { listedProducts } from '../products/catalog'
import { $appShell, setAppShell } from '../store'

const icon = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

function CodingIcon() {
  return (
    <svg {...icon}>
      <path d="M9 8 5 12l4 4M15 8l4 4-4 4" />
    </svg>
  )
}

function WorkbenchIcon() {
  return (
    <svg {...icon}>
      <rect x="4.5" y="5.5" width="6" height="5" rx="1" />
      <rect x="13.5" y="13.5" width="6" height="5" rx="1" />
      <path d="M10.5 8h3.2a2 2 0 0 1 2 2v3.5" />
    </svg>
  )
}

function WritingIcon() {
  return (
    <svg {...icon}>
      <path d="M7 4h8l3 3v13H7z" />
      <path d="M15 4v3h3" />
      <path d="M10 11h6M10 15h4" />
    </svg>
  )
}

function OfficeIcon() {
  return (
    <svg {...icon}>
      <path d="M4 8h16v11H4z" />
      <path d="M9 8V6.2A1.2 1.2 0 0 1 10.2 5h3.6A1.2 1.2 0 0 1 15 6.2V8" />
      <path d="M4 13h16" />
    </svg>
  )
}

function iconForProduct(id: string) {
  if (id === 'coding') return CodingIcon
  if (id === 'workbench') return WorkbenchIcon
  if (id === 'writing') return WritingIcon
  if (id === 'office') return OfficeIcon
  return CodingIcon
}

/** 产品切换。侧栏左上角图标，名称放 title / aria。 */
export function ShellSwitch() {
  const shell = useStore($appShell)
  return (
    <div className="shell-switch" role="tablist" aria-label="界面">
      {listedProducts().map((s) => {
        const Icon = iconForProduct(s.id)
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={shell === s.id}
            aria-label={s.label}
            title={s.label}
            className={`shell-switch-btn${shell === s.id ? ' is-active' : ''}`}
            onClick={() => setAppShell(s.id)}
          >
            <Icon />
          </button>
        )
      })}
    </div>
  )
}
