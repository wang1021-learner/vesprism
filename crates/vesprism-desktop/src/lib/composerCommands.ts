/**
 * 输入栏 / 目录：内置命令 / 技能 / 工作流。
 * 分类和中文说明跟设置里「工具 · 斜杠命令」「技能」「自动化任务」同一套规则。
 */
import { zhCommandLabel, zhCommandPurpose } from './toolChinese'
import { scopeRank, skillScopeLabel } from './skillRows'
import { sourceLabel, sourceRank } from './parseWorkflows'

export type ComposerCommandKind = 'command' | 'skill' | 'workflow'

export const COMPOSER_KIND_LABEL: Record<ComposerCommandKind, string> = {
  command: '命令',
  skill: '技能',
  workflow: '工作流',
}

export const COMPOSER_KIND_ORDER: ComposerCommandKind[] = ['command', 'skill', 'workflow']

export type ComposerCommand = {
  id: string
  label: string
  hint: string
  insert: string
  kind?: ComposerCommandKind
  /** 技能 scope / 工作流 source 原文 */
  source?: string
  /** 本仓库 / 本机 / 内置 … 与设置页分组同一套 */
  sourceLabel?: string
  /** 技能展示名（和 /name 不同才显示） */
  displayName?: string
  run?: () => void
}

type CommandMetaIn = {
  name?: string
  description?: string
  meta?: Record<string, unknown> | null
  _meta?: Record<string, unknown> | null
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function metaOf(c: CommandMetaIn): Record<string, unknown> | null {
  const m = c.meta ?? c._meta
  return m && typeof m === 'object' ? m : null
}

/** 与技能/工作流面板同一套判定：工作流优先，其次 scope+path 算技能 */
export function commandKind(c: CommandMetaIn): ComposerCommandKind {
  const meta = metaOf(c)
  if (!meta) return 'command'
  const wfPath = str(meta.workflowPath ?? meta.workflow_path)
  const wfSource = str(meta.workflowSource ?? meta.workflow_source)
  if (wfPath || wfSource) return 'workflow'
  const path = str(meta.path)
  const scope = str(meta.scope)
  if (path && scope) return 'skill'
  return 'command'
}

function commandHint(name: string, kind: ComposerCommandKind, rawDesc: string): string {
  const desc = rawDesc.replace(/^Workflow:\s*/i, '').trim()
  if (kind === 'skill') {
    return desc || `技能「${name}」—— 在对话中输入 /${name} 可调用`
  }
  if (kind === 'workflow') {
    return desc || `工作流「${name}」`
  }
  return zhCommandPurpose(name) || desc || zhCommandLabel(name) || name
}

function commandSource(
  kind: ComposerCommandKind,
  meta: Record<string, unknown> | null,
): { source?: string; sourceLabel?: string } {
  if (kind === 'skill') {
    const scope = str(meta?.scope).toLowerCase()
    if (!scope) return {}
    return { source: scope, sourceLabel: skillScopeLabel(scope) }
  }
  if (kind === 'workflow') {
    const source = str(meta?.workflowSource ?? meta?.workflow_source).toLowerCase()
    if (!source) return {}
    return { source, sourceLabel: sourceLabel(source) }
  }
  return {}
}

export function parseOfficialCommands(
  raw: CommandMetaIn[] | null | undefined,
): ComposerCommand[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ComposerCommand[] = []
  for (const c of raw) {
    const name = str(c?.name).replace(/^\//, '')
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const kind = commandKind(c)
    const meta = metaOf(c)
    const { source, sourceLabel } = commandSource(kind, meta)
    const displayName = str(meta?.displayName ?? meta?.display_name)
    out.push({
      id: `cmd-${name}`,
      label: `/${name}`,
      hint: commandHint(name, kind, str(c?.description)),
      insert: `/${name} `,
      kind,
      source,
      sourceLabel,
      displayName: displayName && displayName !== name ? displayName : undefined,
    })
  }
  return out
}

/** 官方 `commands/list` 为唯一源；extras 只补桌面独有且官方没有的。 */
export function mergeComposerCommands(
  official: ComposerCommand[],
  extras: ComposerCommand[],
): ComposerCommand[] {
  const seen = new Set(official.map((c) => c.label.toLowerCase()))
  const extra = extras.filter((c) => !seen.has(c.label.toLowerCase()))
  return [...official, ...extra]
}

export function filterComposerCommands(
  items: ComposerCommand[],
  query: string,
): ComposerCommand[] {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  if (!q) return items
  return items.filter((x) => {
    const kind = x.kind || 'command'
    const kindZh = COMPOSER_KIND_LABEL[kind]
    return (
      x.label.slice(1).toLowerCase().startsWith(q) ||
      x.label.toLowerCase().includes(q) ||
      x.hint.toLowerCase().includes(q) ||
      (x.displayName || '').toLowerCase().includes(q) ||
      (x.sourceLabel || '').toLowerCase().includes(q) ||
      kindZh.includes(q)
    )
  })
}

function sortGroup(kind: ComposerCommandKind, items: ComposerCommand[]): ComposerCommand[] {
  if (kind === 'skill') {
    return [...items].sort((a, b) => {
      const d = scopeRank(a.source || '') - scopeRank(b.source || '')
      if (d !== 0) return d
      return a.label.localeCompare(b.label)
    })
  }
  if (kind === 'workflow') {
    return [...items].sort((a, b) => {
      const d = sourceRank(a.source || '') - sourceRank(b.source || '')
      if (d !== 0) return d
      return a.label.localeCompare(b.label)
    })
  }
  return items
}

/**
 * 空查询只留每组首选；打出别名仍能搜到。
 * 这些斜杠打开的是同一块界面，并排三条会误导。
 */
const SLASH_ALIAS_GROUPS: string[][] = [
  ['view-plan', 'show-plan', 'plan-view'],
  ['context', 'usage', 'session-info', 'status', 'info', 'compact-mode'],
  ['always-approve', 'yolo'],
  ['recap', 'summarize'],
  ['plugins', 'marketplace', 'reload-plugins'],
]

export function collapseSlashAliases(
  items: ComposerCommand[],
  query: string,
): ComposerCommand[] {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  const names = new Set(items.map((i) => i.label.slice(1).toLowerCase()))
  const hide = new Set<string>()
  for (const group of SLASH_ALIAS_GROUPS) {
    const present = group.filter((n) => names.has(n))
    if (present.length < 2) continue
    let keep = present[0]
    if (q) {
      const named = present.filter((n) => n.startsWith(q) || n.includes(q))
      if (named.length > 0) keep = named[0]
    }
    for (const n of present) {
      if (n !== keep) hide.add(n)
    }
  }
  if (hide.size === 0) return items
  return items.filter((i) => !hide.has(i.label.slice(1).toLowerCase()))
}

/** 按设置页同类分组：命令 → 技能 → 工作流 */
export function groupComposerCommands(
  items: ComposerCommand[],
): Array<{ kind: ComposerCommandKind; items: ComposerCommand[] }> {
  const map = new Map<ComposerCommandKind, ComposerCommand[]>()
  for (const it of items) {
    const k = it.kind || 'command'
    const list = map.get(k) || []
    list.push(it)
    map.set(k, list)
  }
  return COMPOSER_KIND_ORDER.filter((k) => map.has(k)).map((kind) => ({
    kind,
    items: sortGroup(kind, map.get(kind)!),
  }))
}
