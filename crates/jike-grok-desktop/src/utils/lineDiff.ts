/** 统一 diff 行类型（侧栏高亮用） */
export type DiffLineKind = 'context' | 'add' | 'del' | 'hunk'

export type DiffLine = {
  kind: DiffLineKind
  text: string
  oldNo?: number
  newNo?: number
}

/** 超过此行数走整段替换视图，控制主线程 DP 内存与耗时 */
const LCS_MAX_LINES = 1000

/**
 * 行级 LCS 统一 diff。大文件回退为「整段删除 + 整段新增」，避免 O(n²) 卡顿。
 */
export function computeUnifiedDiff(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)

  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0) {
    return b.map((text, i) => ({ kind: 'add' as const, text, newNo: i + 1 }))
  }
  if (b.length === 0) {
    return a.map((text, i) => ({ kind: 'del' as const, text, oldNo: i + 1 }))
  }

  if (a.length > LCS_MAX_LINES || b.length > LCS_MAX_LINES) {
    return fallbackWholeReplace(a, b)
  }

  return lcsDiff(a, b)
}

function splitLines(s: string): string[] {
  if (!s) return []
  // 保留末尾空行语义：split 会在 trailing \n 后多一个 ''
  const lines = s.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

function fallbackWholeReplace(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [{ kind: 'hunk', text: `@@ 大文件：完整替换视图（${a.length} → ${b.length} 行）@@` }]
  a.forEach((text, i) => out.push({ kind: 'del', text, oldNo: i + 1 }))
  b.forEach((text, i) => out.push({ kind: 'add', text, newNo: i + 1 }))
  return out
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  // DP: dp[i][j] = LCS of a[i..] and b[j..] — 用滚动数组会难回溯，用一维 prev/cur 不够
  // 对于 ≤2500 行，n*m 最大约 6.25e6 个 u16 可接受
  const dp = new Uint16Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * (m + 1) + j

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[idx(i, j)] = dp[idx(i + 1, j + 1)] + 1
      } else {
        dp[idx(i, j)] = Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)])
      }
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i], oldNo: oldNo++, newNo: newNo++ })
      i++
      j++
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      out.push({ kind: 'del', text: a[i], oldNo: oldNo++ })
      i++
    } else {
      out.push({ kind: 'add', text: b[j], newNo: newNo++ })
      j++
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i++], oldNo: oldNo++ })
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j++], newNo: newNo++ })
  }
  return out
}

/**
 * 解析卡片 preview 里简易 `diff path` + `+/-` 行（无结构化 diffs 时的回退）。
 */
export function parsePreviewAsDiffLines(preview: string): DiffLine[] | null {
  const lines = preview.split('\n')
  if (lines.length === 0) return null
  const hasDiffHeader = lines[0].startsWith('diff ')
  const signed = lines.some((l) => l.startsWith('+') || l.startsWith('-'))
  if (!hasDiffHeader && !signed) return null

  const out: DiffLine[] = []
  let oldNo = 1
  let newNo = 1
  for (const line of lines) {
    if (line.startsWith('diff ') || line.startsWith('@@')) {
      out.push({ kind: 'hunk', text: line })
      continue
    }
    if (line.startsWith('+…') || line.startsWith('-…') || line === '…') {
      out.push({ kind: 'hunk', text: line })
      continue
    }
    if (line.startsWith('+')) {
      out.push({ kind: 'add', text: line.slice(1), newNo: newNo++ })
    } else if (line.startsWith('-')) {
      out.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
    } else if (line.startsWith(' ')) {
      out.push({ kind: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    } else {
      out.push({ kind: 'context', text: line })
    }
  }
  return out.length > 0 ? out : null
}
