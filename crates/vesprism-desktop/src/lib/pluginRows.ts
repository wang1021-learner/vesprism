export type PluginRow = {
  id: string
  name: string
  enabled: boolean
  description: string
  version: string
  scope: string
  skillCount: number
  mcpCount: number
  marketplace?: string
  root: string
}

const SCOPE: Record<string, string> = {
  cli: '命令行',
  project: '项目',
  user: '用户',
  config: '配置',
}

export function scopeLabel(s: string): string {
  return SCOPE[s] || s || '其他'
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
      marketplace: String(p.marketplaceSource || p.marketplace_source || '') || undefined,
      root: String(p.root || ''),
    })
  }
  return out
}
