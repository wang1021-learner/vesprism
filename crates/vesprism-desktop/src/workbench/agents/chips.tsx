/**
 * 编制表单：技能/停用工具勾选。名单来自官方 tool catalog 与 skills/list。
 */
import { builtinToolCatalog } from '../../lib/toolCatalog'
import { splitToolList } from './form'

export function ToolDisableChips({
  value,
  extraNames,
  onToggle,
}: {
  value: string
  extraNames: string[]
  onToggle: (name: string) => void
}) {
  const selected = new Set(splitToolList(value))
  const catalog = builtinToolCatalog()
  const known = new Set(catalog.map((t) => t.name))
  const extras = [...selected, ...extraNames].filter((n) => !known.has(n))
  const extraUnique = [...new Set(extras)]
  return (
    <div className="agents-chips" role="group" aria-label="停用工具">
      {catalog.map((t) => {
        const on = selected.has(t.name)
        return (
          <button
            key={t.name}
            type="button"
            className={`agents-chip agents-chip-tool${on ? ' is-on' : ''}`}
            title={`${t.name} · ${t.description}${on ? '（已停用）' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(t.name)}
          >
            {t.label}
          </button>
        )
      })}
      {extraUnique.map((name) => (
        <button
          key={name}
          type="button"
          className="agents-chip agents-chip-tool is-on"
          title={`${name}（已停用，点按移除）`}
          aria-pressed
          onClick={() => onToggle(name)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

export function SkillMountChips({
  value,
  options,
  onToggle,
}: {
  value: string
  options: Array<{ name: string; label: string }>
  onToggle: (name: string) => void
}) {
  const selected = new Set(splitToolList(value))
  const seen = new Set<string>()
  const rows: Array<{ name: string; label: string }> = []
  for (const o of options) {
    if (!o.name || seen.has(o.name)) continue
    seen.add(o.name)
    rows.push(o)
  }
  for (const name of selected) {
    if (seen.has(name)) continue
    seen.add(name)
    rows.push({ name, label: name })
  }
  if (rows.length === 0) {
    return <p className="agents-hint">当前会话还没列出技能。可在下方手动填写名称。</p>
  }
  return (
    <div className="agents-chips" role="group" aria-label="挂载技能">
      {rows.map((s) => {
        const on = selected.has(s.name)
        return (
          <button
            key={s.name}
            type="button"
            className={`agents-chip agents-chip-skill${on ? ' is-on' : ''}`}
            title={s.name}
            aria-pressed={on}
            onClick={() => onToggle(s.name)}
          >
            {s.label || s.name}
          </button>
        )
      })}
    </div>
  )
}
