/**
 * 解析官方工作流列表（x.ai/workflows/list 或 commands/list 中的 workflow 条目）
 */

export type WorkflowRow = {
  name: string
  description: string
  whenToUse: string
  source: string
  path: string
}

const SOURCE_ORDER = [
  'project',
  'local',
  'repo',
  'user',
  'global',
  'bundled',
  'plugin',
  'session',
]

export function sourceRank(source: string): number {
  const i = SOURCE_ORDER.indexOf(source.toLowerCase())
  return i < 0 ? 99 : i
}

/** 展示用分组：本仓库 / 本机 / 内置 / 插件 / 会话（与技能页同一套中文） */
export function sourceBucket(source: string): string {
  switch (source.trim().toLowerCase()) {
    case 'project':
    case 'local':
    case 'repo':
      return 'workspace'
    case 'user':
    case 'global':
      return 'machine'
    case 'bundled':
      return 'bundled'
    case 'plugin':
      return 'plugin'
    case 'session':
      return 'session'
    default:
      return source.trim().toLowerCase() || 'machine'
  }
}

export const SOURCE_BUCKET_LABEL: Record<string, string> = {
  workspace: '本仓库',
  machine: '本机',
  bundled: '内置',
  plugin: '插件',
  session: '会话',
}

export const SOURCE_BUCKET_ORDER = [
  'workspace',
  'machine',
  'bundled',
  'plugin',
  'session',
] as const

/** 来源中文标签（project/local/repo 都叫本仓库，跟技能页对齐） */
export function sourceLabel(source: string): string {
  const b = sourceBucket(source)
  return SOURCE_BUCKET_LABEL[b] || source || '其他'
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 规范化 workflows/list 响应中的数组项。
 */
export function parseWorkflowListings(
  items: Array<Record<string, unknown> | null | undefined> | null | undefined,
): WorkflowRow[] {
  if (!Array.isArray(items)) return []
  const out: WorkflowRow[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const name = str(raw.name).replace(/^\//, '')
    if (!name || seen.has(name)) continue
    seen.add(name)
    const description = str(raw.description).replace(/^Workflow:\s*/i, '')
    const whenToUse = str(raw.when_to_use ?? raw.whenToUse)
    const source = str(raw.source).toLowerCase() || 'unknown'
    const path = str(raw.path)
    out.push({
      name,
      description: description || `工作流「${name}」`,
      whenToUse,
      source,
      path,
    })
  }
  out.sort((a, b) => {
    const d = sourceRank(a.source) - sourceRank(b.source)
    if (d !== 0) return d
    return a.name.localeCompare(b.name)
  })
  return out
}

/**
 * 从 commands/list 的 commands 里筛出 workflow（meta 含 workflowPath / workflowSource）。
 * 作为 workflows/list 空列表时的回退。
 */
export function parseWorkflowsFromCommands(
  commands:
    | Array<{
        name?: string
        description?: string
        meta?: Record<string, unknown> | null
        _meta?: Record<string, unknown> | null
      }>
    | null
    | undefined,
): WorkflowRow[] {
  if (!Array.isArray(commands)) return []
  const items: Array<Record<string, unknown>> = []
  for (const c of commands) {
    const meta = c.meta ?? c._meta
    if (!meta || typeof meta !== 'object') continue
    const path = str(meta.workflowPath ?? meta.workflow_path)
    const source = str(meta.workflowSource ?? meta.workflow_source)
    // 官方技能也有 path+scope；工作流用 workflowPath / workflowSource 区分
    if (!path && !source) continue
    if (meta.scope && !path && !source) continue
    const name = str(c.name).replace(/^\//, '')
    if (!name) continue
    items.push({
      name,
      description: str(c.description),
      when_to_use: str(meta.when_to_use ?? meta.whenToUse),
      source: source || 'unknown',
      path,
    })
  }
  return parseWorkflowListings(items)
}
