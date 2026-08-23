/**
 * 技能面板行：对齐官方 SkillInfo（x.ai/skills/list）与
 * commands/list 里带 scope+path 的技能斜杠。
 */

import type { SkillInfoDto } from '../bridge'

export type SkillRow = {
  name: string
  displayName: string
  description: string
  whenToUse?: string
  scope: string
  path: string
  plugin?: string
  argumentHint?: string
  enabled: boolean
  userInvocable: boolean
  disableModelInvocation: boolean
  allowedTools?: string[]
  /** 来自 config.toml [skills].paths，可用官方 skills/remove */
  removable: boolean
}

export const SKILL_SCOPE_LABEL: Record<string, string> = {
  local: '本地 (cwd)',
  repo: '仓库',
  user: '用户',
  server: '服务器',
  bundled: '内置',
  plugin: '插件',
}

export const SKILL_SCOPE_ORDER = [
  'local',
  'repo',
  'user',
  'server',
  'bundled',
  'plugin',
] as const

function metaOf(cmd: {
  meta?: Record<string, unknown> | null
  _meta?: Record<string, unknown> | null
}): Record<string, unknown> | null {
  const m = cmd.meta ?? cmd._meta
  return m && typeof m === 'object' ? m : null
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function configSourceType(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const t = (raw as { type?: unknown }).type
  return str(t).toLowerCase()
}

function isRemovableSource(raw: unknown): boolean {
  const t = configSourceType(raw)
  return t === 'configtoml' || t === 'config_toml' || t === 'cli'
}

export function scopeRank(s: string): number {
  const i = SKILL_SCOPE_ORDER.indexOf(s as (typeof SKILL_SCOPE_ORDER)[number])
  return i < 0 ? 99 : i
}

export function sortSkillRows(rows: SkillRow[]): SkillRow[] {
  return [...rows].sort((a, b) => {
    const sa = scopeRank(a.scope) - scopeRank(b.scope)
    if (sa !== 0) return sa
    return a.name.localeCompare(b.name)
  })
}

export function parseOfficialSkills(raw: SkillInfoDto[]): SkillRow[] {
  const out: SkillRow[] = []
  for (const s of raw) {
    const name = str(s.name).replace(/^\//, '')
    if (!name) continue
    const displayName = str(s.displayName ?? s.display_name) || name
    const description = str(
      s.description ||
        s.shortDescription ||
        s.short_description ||
        s.whenToUse ||
        s.when_to_use,
    )
    const whenToUse = str(s.whenToUse ?? s.when_to_use)
    const allowed = s.allowedTools ?? s.allowed_tools
    out.push({
      name,
      displayName,
      description: description || `技能「${displayName}」—— 在对话中输入 /${name} 可调用`,
      whenToUse: whenToUse && whenToUse !== description ? whenToUse : undefined,
      scope: str(s.scope || 'user').toLowerCase(),
      path: str(s.path),
      plugin: s.pluginName || s.plugin_name || undefined,
      argumentHint: s.argumentHint || s.argument_hint || undefined,
      enabled: s.enabled !== false,
      userInvocable: s.userInvocable !== false && s.user_invocable !== false,
      disableModelInvocation: Boolean(
        s.disableModelInvocation ?? s.disable_model_invocation,
      ),
      allowedTools: Array.isArray(allowed)
        ? allowed.map((x) => str(x)).filter(Boolean)
        : undefined,
      removable: isRemovableSource(s.configSource ?? s.config_source),
    })
  }
  return sortSkillRows(out)
}

export function parseSkillsFromCommands(
  commands: Array<{
    name?: string
    description?: string
    input?: unknown
    meta?: Record<string, unknown> | null
    _meta?: Record<string, unknown> | null
  }>,
): SkillRow[] {
  const out: SkillRow[] = []
  for (const c of commands) {
    const meta = metaOf(c)
    if (!meta) continue
    const path = str(meta.path)
    const scope = str(meta.scope).toLowerCase()
    if (!path || !scope) continue
    if (meta.workflowPath || meta.workflowSource) continue
    const name = str(c.name).replace(/^\//, '')
    if (!name) continue
    const displayName = str(meta.displayName ?? meta.display_name) || name
    const description = str(
      c.description ||
        meta.short_description ||
        meta.shortDescription ||
        meta.when_to_use ||
        meta.whenToUse ||
        meta.description,
    )
    let argumentHint = ''
    const input = c.input as
      | { hint?: string; unstructured?: { hint?: string } }
      | undefined
    if (input && typeof input === 'object') {
      argumentHint = str(input.hint ?? input.unstructured?.hint)
    }
    out.push({
      name,
      displayName,
      description:
        description || `技能「${displayName}」—— 在对话中输入 /${name} 可调用`,
      scope,
      path,
      plugin: meta.plugin ? String(meta.plugin) : undefined,
      argumentHint: argumentHint || undefined,
      enabled: true,
      userInvocable: true,
      disableModelInvocation: false,
      removable: false,
    })
  }
  return sortSkillRows(out)
}

/** 官方 add 接受 SKILL.md 或技能目录。 */
export function isSkillAddPath(path: string): boolean {
  const p = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!p) return false
  const base = p.split('/').pop() || ''
  return base.toLowerCase() === 'skill.md' || !base.toLowerCase().endsWith('.md')
}

/** 预览时去掉 YAML frontmatter，只留正文。 */
export function skillPreviewBody(md: string): string {
  const text = md.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return text.trim()
  const nl = text.startsWith('---\r\n') ? '\r\n' : '\n'
  const end = text.indexOf(`${nl}---`, 3)
  if (end < 0) return text.trim()
  return text.slice(end + nl.length + 3).trim()
}
