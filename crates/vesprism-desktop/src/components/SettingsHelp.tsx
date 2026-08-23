import type { ReactNode } from 'react'

/** 标签旁的「？」：悬停或键盘聚焦时显示说明。 */
export function SettingsHelp({ text }: { text: string }) {
  return (
    <span className="settings-help">
      <button
        type="button"
        className="settings-help-mark"
        aria-label={text}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        ?
      </button>
      <span className="settings-help-tip" role="tooltip">
        {text}
      </span>
    </span>
  )
}

export function SettingsLabel({
  htmlFor,
  help,
  children,
  className,
}: {
  htmlFor?: string
  help: string
  children: ReactNode
  className?: string
}) {
  return (
    <label
      className={`settings-label${className ? ` ${className}` : ''}`}
      htmlFor={htmlFor}
    >
      <span className="settings-label-text">{children}</span>
      <SettingsHelp text={help} />
    </label>
  )
}
