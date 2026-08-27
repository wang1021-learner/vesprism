/** 与桌面 session_index 同一把钥匙：斜杠、长路径、尾斜杠、大小写。 */
/** 路径是否落在工作区根下（含根自身）。空根不过滤。不解析盘上的 symlink，只挡 `..` 段。 */
export function pathUnderWorkspace(path: string, root: string): boolean {
  const p = normalizeWorkspacePath(path)
  const r = normalizeWorkspacePath(root)
  if (!r) return true
  if (p.split('/').includes('..')) return false
  return p === r || p.startsWith(`${r}/`)
}

export function normalizeWorkspacePath(path: string): string {
  let s = path.trim().replace(/\\/g, '/')
  const lower = s.toLowerCase()
  if (lower.startsWith('//?/unc/')) {
    s = `//${s.slice('//?/unc/'.length)}`
  } else if (lower.startsWith('//?/')) {
    s = s.slice('//?/'.length)
  }
  if (s.length > 1) {
    while (s.endsWith('/')) {
      const keepDriveRoot = s.length === 3 && s.charAt(1) === ':'
      if (keepDriveRoot) break
      s = s.slice(0, -1)
      if (!s) break
    }
  }
  return s.toLowerCase()
}

export function workspaceFolderName(cwd: string): string {
  const key = normalizeWorkspacePath(cwd)
  if (!key) return '(未知工作空间)'
  const parts = key.split('/').filter(Boolean)
  return parts[parts.length - 1] || key
}

/** 展示时优先留 Windows 盘符原样（`D:\foo`），避免和索引里的 `d:/foo` 并排出现。 */
export function preferWorkspaceDisplayPath(a: string, b: string): string {
  const native = (p: string) => p.includes('\\') || /^[A-Z]:/.test(p.trim())
  if (native(b) && !native(a)) return b
  if (native(a) && !native(b)) return a
  return b
}

/** 按规范化钥匙去重；同一仓库只留一条。 */
export function dedupeWorkspacePaths(paths: string[]): string[] {
  const map = new Map<string, string>()
  for (const p of paths) {
    const key = normalizeWorkspacePath(p)
    if (!key) continue
    const prev = map.get(key)
    map.set(key, prev ? preferWorkspaceDisplayPath(prev, p) : p)
  }
  return [...map.values()]
}
