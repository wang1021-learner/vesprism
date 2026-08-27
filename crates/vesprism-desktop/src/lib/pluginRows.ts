export type PluginRow = {
  id: string
  name: string
  enabled: boolean
  description: string
  version: string
  scope: string
  skillCount: number
  mcpCount: number
  hookCount: number
  hookStatus: string
  mcpStatus: string
  marketplace?: string
  root: string
}

const SCOPE: Record<string, string> = {
  cli: '本机',
  project: '本仓库',
  user: '本机',
  config: '本机配置',
}

export function scopeLabel(s: string): string {
  const k = (s || '').trim().toLowerCase()
  return SCOPE[k] || s || '其他'
}

const STATUS: Record<string, string> = {
  none: '无',
  active: '已加载',
  active_inline: '已加载（内联）',
  blocked: '已拦截',
}

export function pluginStatusLabel(s: string): string {
  const k = (s || '').trim().toLowerCase()
  return STATUS[k] || s
}

export function parsePluginList(raw: unknown): PluginRow[] {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(o.plugins) ? o.plugins : Array.isArray(raw) ? raw : []
  const out: PluginRow[] = []
  for (const item of list) {
    const p = (item || {}) as Record<string, unknown>
    const id = String(p.id || p.name || '').trim()
    if (!id) continue
    out.push({
      id,
      name: String(p.name || id),
      enabled: p.enabled !== false,
      description: String(p.description || ''),
      version: String(p.version || ''),
      scope: String(p.scope || ''),
      skillCount: Number(p.skillCount ?? p.skill_count ?? 0),
      mcpCount: Number(p.mcpServerCount ?? p.mcp_server_count ?? 0),
      hookCount: Number(p.hookCount ?? p.hook_count ?? 0),
      hookStatus: String(p.hookStatus || p.hook_status || ''),
      mcpStatus: String(p.mcpStatus || p.mcp_status || ''),
      marketplace: String(p.marketplaceSource || p.marketplace_source || '') || undefined,
      root: String(p.root || ''),
    })
  }
  return out
}
