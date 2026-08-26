/**
 * MCP 面板行：对齐官方 x.ai/mcp/list 条目。
 */

import type { McpServerDto, McpSetupDto, McpSetupFieldDto } from '../bridge'

export type McpToolRow = {
  name: string
  label: string
  description: string
  enabled: boolean
}

export type McpGroupId = 'managed' | 'plugin' | 'local'

export type McpRow = {
  name: string
  displayName: string
  source: string
  sourceLabel: string
  group: McpGroupId
  transport: string
  detail: string
  enabled: boolean
  status: string
  statusDetail: string
  tools: McpToolRow[]
  authRequired: boolean
  setupRequired: boolean
  setup?: McpSetupDto | null
  env: Record<string, string>
  command: string
  args: string[]
  url: string
  /** 本地 config 条目可删可改；托管不可 */
  canDelete: boolean
  canEdit: boolean
}

export const MCP_GROUP_ORDER: McpGroupId[] = ['managed', 'plugin', 'local']

export const MCP_GROUP_LABEL: Record<McpGroupId, string> = {
  managed: '平台托管',
  plugin: '插件带来的',
  local: '本机添加',
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

export function parseEnvBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    if (!key) continue
    let val = t.slice(eq + 1)
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

export function formatEnvBlock(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([k]) => k.trim())
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function parseEnv(raw: McpServerDto['env']): Record<string, string> {
  if (!raw) return {}
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const item of raw) {
      const name = str(item?.name)
      if (name) out[name] = str(item?.value)
    }
    return out
  }
  if (typeof raw === 'object') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k.trim()) out[k] = str(v)
    }
    return out
  }
  return {}
}

export function mcpGroupOf(source: string, sourceLabel: string, transport: string): McpGroupId {
  const s = source.toLowerCase()
  const label = sourceLabel.toLowerCase()
  if (s === 'managed' || transport === 'managed') return 'managed'
  if (label.startsWith('plugin:') || s === 'plugin') return 'plugin'
  return 'local'
}

export function statusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'ready':
      return '就绪'
    case 'initializing':
      return '初始化'
    case 'setuprequired':
    case 'setup_required':
      return '需配置'
    case 'needsauth':
    case 'needs_auth':
      return '需登录'
    case 'unavailable':
      return '不可用'
    default:
      return status || '—'
  }
}

export function validServerName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)
}

export function splitArgs(raw: string): string[] {
  const out: string[] = []
  const s = raw ?? ''
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const q = s[i]
    if (q === '"' || q === "'") {
      i++
      let acc = ''
      while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) {
          acc += s[i + 1]
          i += 2
          continue
        }
        if (s[i] === q) {
          i++
          break
        }
        acc += s[i]
        i++
      }
      out.push(acc)
      continue
    }
    let acc = ''
    while (i < s.length && !/\s/.test(s[i])) {
      acc += s[i]
      i++
    }
    out.push(acc)
  }
  return out
}

export function joinArgs(args: string[]): string {
  return args
    .map((a) => {
      if (!/[\s"']/.test(a)) return a
      if (!/'/.test(a)) return `'${a}'`
      return `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    })
    .join(' ')
}

export function normalizeMcpServer(s: McpServerDto): McpRow {
  const session = s.session
  const displayName =
    (s.displayName || s.display_name || s.name || '').trim() || s.name
  const type = (s.type || '').toLowerCase()
  let transport = type || 'unknown'
  let detail = ''
  const url = str(s.url)
  const command = str(s.command)
  const args = Array.isArray(s.args) ? s.args.map((a) => String(a)) : []
  if (type === 'http' || type === 'sse' || url) {
    transport = type === 'sse' ? 'sse' : 'http'
    detail = url
  } else if (type === 'stdio' || command) {
    transport = 'stdio'
    detail = [command, args.join(' ')].filter(Boolean).join(' ')
  } else if (type === 'managedgateway') {
    transport = 'managed'
    detail = '托管连接器'
  }
  const source = String(s.source || 'local').toLowerCase()
  const sourceLabel = (s.sourceLabel || s.source_label || s.source || '').toString()
  const tools = (session?.tools || []).map((t) => ({
    name: t.name,
    label: (t.displayName || t.display_name || t.name || '').trim() || t.name,
    description: (t.description || '').trim(),
    enabled: t.enabled !== false,
  }))
  const group = mcpGroupOf(source, sourceLabel, transport)
  const canDelete = group === 'local'
  return {
    name: s.name,
    displayName,
    source,
    sourceLabel,
    group,
    transport,
    detail,
    enabled: session?.enabled !== false,
    status: (session?.status || (session ? 'ready' : '—')).toString(),
    statusDetail: '',
    tools,
    authRequired: Boolean(session?.authRequired ?? session?.auth_required),
    setupRequired: Boolean(session?.setupRequired ?? session?.setup_required),
    setup: s.setup ?? null,
    env: parseEnv(s.env),
    command,
    args,
    url,
    canDelete,
    canEdit: canDelete,
  }
}

export function groupMcpRows(rows: McpRow[]): Array<{ group: McpGroupId; items: McpRow[] }> {
  const map = new Map<McpGroupId, McpRow[]>()
  for (const row of rows) {
    const list = map.get(row.group) || []
    list.push(row)
    map.set(row.group, list)
  }
  return MCP_GROUP_ORDER.filter((g) => map.has(g)).map((group) => ({
    group,
    items: map.get(group)!,
  }))
}

export function applyMcpStatusPush(
  rows: McpRow[],
  payload: Record<string, unknown>,
): McpRow[] {
  const name = str(payload.name)
  if (!name) return rows
  const status = str(payload.status).toLowerCase()
  const detail = str(payload.detail)
  return rows.map((row) => {
    if (row.name !== name) return row
    const authRequired = status === 'needsauth' || status === 'needs_auth' || row.authRequired
    const nextStatus = status || row.status
    return {
      ...row,
      status: nextStatus,
      statusDetail: detail,
      authRequired: status === 'ready' ? false : authRequired,
      enabled: status === 'disabled' ? false : row.enabled,
    }
  })
}

export function applyMcpToolsPush(
  rows: McpRow[],
  payload: Record<string, unknown>,
): McpRow[] {
  const name = str(payload.serverName ?? payload.server_name)
  const toolsRaw = payload.tools
  if (!name || !Array.isArray(toolsRaw) || toolsRaw.length === 0) return rows
  const tools: McpToolRow[] = toolsRaw.map((t) => {
    const o = t && typeof t === 'object' ? (t as Record<string, unknown>) : {}
    const n = str(o.name)
    return {
      name: n,
      label: str(o.displayName ?? o.display_name) || n,
      description: str(o.description),
      enabled: o.enabled !== false,
    }
  })
  return rows.map((row) => (row.name === name ? { ...row, tools } : row))
}

export function setupFields(setup: McpSetupDto | null | undefined): McpSetupFieldDto[] {
  return Array.isArray(setup?.fields) ? setup!.fields.filter((f) => str(f.id)) : []
}
