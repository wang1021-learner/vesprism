/** 官方记忆路径：`$GROK_HOME/memory/MEMORY.md` 或 `memory/<slug>-<hash8>/…` */

export function workspaceFolderName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || cwd || ''
}

/** `owner-repo-deadbeef` → `owner-repo`；全局 MEMORY.md 没有这一段。 */
export function memoryDirSlug(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const i = parts.findIndex((p) => p.toLowerCase() === 'memory')
  if (i < 0 || i + 1 >= parts.length) return ''
  const next = parts[i + 1]
  if (!next || next.toLowerCase() === 'memory.md' || next.toLowerCase() === 'sessions') {
    return ''
  }
  return next.replace(/-[a-fA-F0-9]{8}$/, '')
}

export function memoryFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

export function memoryRowTitle(
  path: string,
  source: string,
  cwd: string,
): { title: string; hint: string; chip: string } {
  const slug = memoryDirSlug(path)
  const file = memoryFileName(path)
  const project = workspaceFolderName(cwd)
  if (source === 'global') {
    return {
      title: '所有项目共用',
      hint: file,
      chip: '全局',
    }
  }
  if (source === 'workspace') {
    const name = slug || project || '当前仓库'
    const same = project && slug && (slug === project || slug.endsWith(`-${project}`) || slug.endsWith(project))
    return {
      title: name,
      hint: same || !project ? '当前打开的仓库' : `目录 ${name}`,
      chip: same || !slug || slug === project ? '本仓库' : '仓库',
    }
  }
  return {
    title: file,
    hint: slug ? `${slug} 的会话日志` : '会话日志',
    chip: '会话',
  }
}

export type MemoryGroupId = 'global' | 'workspace' | 'other' | 'session'

export const MEMORY_GROUP_ORDER: readonly MemoryGroupId[] = [
  'global',
  'workspace',
  'other',
  'session',
]

export const MEMORY_GROUP_LABEL: Record<MemoryGroupId, string> = {
  global: '所有项目共用',
  workspace: '当前仓库',
  other: '其它仓库',
  session: '会话日志',
}

export function memoryGroupId(
  path: string,
  source: string,
  cwd: string,
): MemoryGroupId {
  if (source === 'global') return 'global'
  if (source === 'session') return 'session'
  const meta = memoryRowTitle(path, source, cwd)
  if (meta.chip === '本仓库') return 'workspace'
  return 'other'
}

export function groupMemoryFiles<T extends { path: string; source: string }>(
  files: T[],
  cwd: string,
): { id: MemoryGroupId; label: string; files: T[] }[] {
  const buckets = new Map<MemoryGroupId, T[]>()
  for (const f of files) {
    const id = memoryGroupId(f.path, f.source, cwd)
    const list = buckets.get(id)
    if (list) list.push(f)
    else buckets.set(id, [f])
  }
  return MEMORY_GROUP_ORDER.filter((id) => (buckets.get(id) || []).length > 0).map(
    (id) => ({
      id,
      label: MEMORY_GROUP_LABEL[id],
      files: buckets.get(id)!,
    }),
  )
}
