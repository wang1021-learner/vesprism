import { useContext, type ChangeEvent, type ReactNode } from 'react'
import { foreshadowLabel } from '../model/dossier'
import type { ForeshadowState } from '../model/types'
import { AiFillCtx } from './edit-ctx'

function isBlank(node: ReactNode): boolean {
  if (node == null || node === false) return true
  if (typeof node === 'string' && node.trim() === '') return true
  return false
}

function autoRows(value: string, min: number, max: number): number {
  const lines = value.split('\n').length
  const wrap = Math.ceil((value.length || 1) / 22)
  return Math.min(max, Math.max(min, lines, wrap))
}

export function Field({
  label,
  children,
  value,
  onChange,
  hint,
  warn,
  short,
  options,
  disabled,
}: {
  label: string
  children?: ReactNode
  value?: string
  onChange?: (value: string) => void
  hint?: string
  warn?: boolean
  short?: boolean
  options?: readonly string[]
  disabled?: boolean
}) {
  const onAiFill = useContext(AiFillCtx)
  const shown = value ?? (typeof children === 'string' ? children : '')
  const empty = value != null ? shown.trim() === '' : isBlank(children)
  const editable = Boolean(onChange)
  const cls = `wd-field${warn ? ' is-warn' : ''}${empty ? ' is-empty' : ''}${editable ? ' is-edit' : ''}`

  let control: ReactNode
  if (!onChange) {
    control = <span className="wd-field-v">{empty ? '还没填' : children}</span>
  } else if (options) {
    control = (
      <select
        className="wd-field-input"
        aria-label={label}
        value={shown}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {empty ? <option value="">还没选</option> : null}
        {shown && !options.includes(shown) ? <option value={shown}>{shown}</option> : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  } else if (short) {
    control = (
      <input
        className="wd-field-input"
        aria-label={label}
        value={shown}
        disabled={disabled}
        placeholder="点这里写"
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else {
    control = (
      <textarea
        className="wd-field-input"
        aria-label={label}
        value={shown}
        disabled={disabled}
        placeholder="点这里写"
        rows={autoRows(shown, empty ? 2 : 1, 8)}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  const Tag = onChange ? 'label' : 'div'
  return (
    <Tag className={cls}>
      <span className="wd-field-head">
        <span className="wd-field-k">{label}</span>
        {editable && onAiFill && empty && !disabled ? (
          <button
            type="button"
            className="wd-field-ai"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAiFill(label)
            }}
          >
            AI 填
          </button>
        ) : null}
      </span>
      {control}
      {hint ? <span className="wd-field-hint">{hint}</span> : null}
    </Tag>
  )
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="wd-field-row">{children}</div>
}

export function Zone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wd-zone">
      <h3 className="wd-zone-h">{title}</h3>
      {children}
    </div>
  )
}

export function Section({
  kicker,
  title,
  lot,
  lead,
  wide,
  children,
}: {
  kicker?: string
  title: string
  lot?: string
  lead?: string
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <section className={`wd-section${wide ? ' is-wide' : ''}`}>
      <header className="wd-section-h">
        {lot ? (
          <span className="wd-lot" aria-hidden>
            {lot}
          </span>
        ) : null}
        <div>
          {kicker ? <p className="wd-kicker">{kicker}</p> : null}
          <h2>{title}</h2>
        </div>
      </header>
      {lead ? <p className="wd-lead">{lead}</p> : null}
      {children ?? null}
    </section>
  )
}

export function Stamp({
  tone,
  children,
}: {
  tone: 'ok' | 'due' | 'lock' | 'open'
  children: string
}) {
  return <span className={`wd-stamp is-${tone}`}>{children}</span>
}

export function ForeshadowStamp({ state }: { state: ForeshadowState }) {
  const tone = state === 'due' ? 'due' : state === 'closed' ? 'ok' : 'open'
  return <Stamp tone={tone}>{foreshadowLabel(state)}</Stamp>
}
