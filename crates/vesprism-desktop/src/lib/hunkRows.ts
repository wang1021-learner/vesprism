/**
 * 官方 x.ai/hunk-tracker 列表与动作载荷。
 * 接受/拒绝会改磁盘；不是 git 暂存。
 */

export type HunkFileRow = {
  path: string
  isAgentFile: boolean
  staged: boolean
  hunkCount: number
  additions: number
  deletions: number
}

export type HunkRow = {
  id: string
  path: string
  patch: string
  oldText: string
  newText: string
  source: 'agent' | 'external'
  promptIndex: number | null
}

function str(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && 'path' in (v as object)) {
    return String((v as { path?: unknown }).path || '')
  }
  return v == null ? '' : String(v)
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function hunkId(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    return str(o.id ?? o.Id ?? o[0])
  }
  return ''
}

function hunkSource(raw: unknown): { source: HunkRow['source']; promptIndex: number | null } {
  if (!raw || typeof raw !== 'object') {
    const s = String(raw || '').toLowerCase()
    return { source: s.includes('agent') ? 'agent' : 'external', promptIndex: null }
  }
  const o = raw as Record<string, unknown>
  const agent = o.agentEdit ?? o.AgentEdit
  if (agent && typeof agent === 'object') {
    const idx = num((agent as Record<string, unknown>).promptIndex ?? (agent as Record<string, unknown>).prompt_index)
    return { source: 'agent', promptIndex: idx || null }
  }
  if ('promptIndex' in o || 'prompt_index' in o) {
    return { source: 'agent', promptIndex: num(o.promptIndex ?? o.prompt_index) || null }
  }
  return { source: 'external', promptIndex: null }
}

export function parseHunkFiles(raw: unknown): HunkFileRow[] {
  const root = (raw || {}) as Record<string, unknown>
  const list = Array.isArray(root.files) ? root.files : Array.isArray(raw) ? raw : []
  const out: HunkFileRow[] = []
  for (const item of list) {
    const o = (item || {}) as Record<string, unknown>
    const path = str(o.path)
    if (!path) continue
    out.push({
      path,
      isAgentFile: Boolean(o.isAgentFile ?? o.is_agent_file),
      staged: Boolean(o.staged),
      hunkCount: num(o.hunkCount ?? o.hunk_count),
      additions: num(o.additions),
      deletions: num(o.deletions),
    })
  }
  return out
}

export function parseHunks(raw: unknown): HunkRow[] {
  const root = (raw || {}) as Record<string, unknown>
  const list = Array.isArray(root.hunks) ? root.hunks : Array.isArray(raw) ? raw : []
  const out: HunkRow[] = []
  for (const item of list) {
    const o = (item || {}) as Record<string, unknown>
    const id = hunkId(o.id)
    if (!id) continue
    const src = hunkSource(o.source)
    out.push({
      id,
      path: str(o.path),
      patch: str(o.patch),
      oldText: str(o.oldText ?? o.old_text),
      newText: str(o.newText ?? o.new_text),
      source: src.source,
      promptIndex: src.promptIndex,
    })
  }
  return out
}

export function relPath(path: string, cwd: string): string {
  const p = path.replace(/\\/g, '/')
  const c = (cwd || '').replace(/\\/g, '/').replace(/\/$/, '')
  if (c && p.toLowerCase().startsWith(c.toLowerCase() + '/')) return p.slice(c.length + 1)
  return p
}

export function hunkActionOk(raw: unknown): { ok: boolean; error: string; affected: number } {
  const o = (raw || {}) as Record<string, unknown>
  const err = str(o.error)
  const affected = num(o.affectedCount ?? o.affected_count)
  if (o.success === false) return { ok: false, error: err || '操作失败', affected }
  return { ok: true, error: '', affected }
}
