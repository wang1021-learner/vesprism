/** 官方 `x.ai/marketplace/list` 的桌面投影。 */

export type MarketplacePlugin = {
  name: string
  version: string
  description: string
  category: string
  author: string
  relativePath: string
  sourceUrl: string
  sourceName: string
  skillCount: number
  hasHooks: boolean
  hasMcp: boolean
  installStatus: string
  remoteUrl: string
}

export type MarketplaceSource = {
  name: string
  kind: string
  url: string
  error: string
  plugins: MarketplacePlugin[]
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function installStatusLabel(status: string): string {
  switch ((status || '').trim().toLowerCase()) {
    case 'installed':
      return '已安装'
    case 'update_available':
      return '可更新'
    case 'not_installed':
      return '未安装'
    default:
      return status || '未知'
  }
}

export function parseMarketplaceList(raw: unknown): MarketplaceSource[] {
  const root = obj(raw)
  const list = Array.isArray(root.sources) ? root.sources : Array.isArray(raw) ? raw : []
  const out: MarketplaceSource[] = []
  for (const item of list) {
    const s = obj(item)
    const url = str(s.sourceUrlOrPath ?? s.source_url_or_path)
    const name = str(s.sourceName ?? s.source_name) || url || '商店源'
    const pluginsRaw = Array.isArray(s.plugins) ? s.plugins : []
    const plugins: MarketplacePlugin[] = []
    for (const p of pluginsRaw) {
      const o = obj(p)
      const pluginName = str(o.name)
      const relativePath = str(o.relativePath ?? o.relative_path)
      if (!pluginName && !relativePath) continue
      plugins.push({
        name: pluginName || relativePath,
        version: str(o.version),
        description: str(o.description),
        category: str(o.category),
        author: str(o.author),
        relativePath,
        sourceUrl: url,
        sourceName: name,
        skillCount: Number(o.skillCount ?? o.skill_count ?? 0) || 0,
        hasHooks: Boolean(o.hasHooks ?? o.has_hooks),
        hasMcp: Boolean(o.hasMcp ?? o.has_mcp),
        installStatus: str(o.installStatus ?? o.install_status) || 'not_installed',
        remoteUrl: str(o.remoteUrl ?? o.remote_url),
      })
    }
    out.push({
      name,
      kind: str(s.sourceKind ?? s.source_kind),
      url,
      error: str(s.error),
      plugins,
    })
  }
  return out
}
