import { zhCommandLabel, zhCommandPurpose } from './toolChinese'

export type ComposerCommandKind = 'command' | 'skill' | 'workflow'

export type ComposerCommand = {
  id: string
  label: string
  hint: string
  insert: string
  kind?: ComposerCommandKind
  run?: () => void
}

function commandKind(c: {
  meta?: Record<string, unknown> | null
  _meta?: Record<string, unknown> | null
}): ComposerCommandKind {
  const meta = c.meta ?? c._meta
  if (!meta || typeof meta !== 'object') return 'command'
  if (meta.workflowPath || meta.workflowSource) return 'workflow'
  const path = String(meta.path ?? '').trim()
  const scope = String(meta.scope ?? '').trim()
  if (path && scope) return 'skill'
  return 'command'
}

export function parseOfficialCommands(
  raw:
    | Array<{
        name?: string
        description?: string
        meta?: Record<string, unknown> | null
        _meta?: Record<string, unknown> | null
      }>
    | null
    | undefined,
): ComposerCommand[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ComposerCommand[] = []
  for (const c of raw) {
    const name = String(c?.name || '')
      .trim()
      .replace(/^\//, '')
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const kind = commandKind(c)
    const purpose = zhCommandPurpose(name) || String(c?.description || '').trim()
    const title = zhCommandLabel(name) || name
    out.push({
      id: `cmd-${name}`,
      label: `/${name}`,
      hint: purpose || title,
      insert: `/${name} `,
      kind,
    })
  }
  return out
}

export function mergeComposerCommands(
  official: ComposerCommand[],
  extras: ComposerCommand[],
): ComposerCommand[] {
  const seen = new Set(official.map((c) => c.label.toLowerCase()))
  const extra = extras.filter((c) => !seen.has(c.label.toLowerCase()))
  return [...extra, ...official]
}

export function filterComposerCommands(
  items: ComposerCommand[],
  query: string,
): ComposerCommand[] {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  if (!q) return items
  return items.filter(
    (x) =>
      x.label.slice(1).toLowerCase().startsWith(q) ||
      x.label.toLowerCase().includes(q) ||
      x.hint.toLowerCase().includes(q),
  )
}
