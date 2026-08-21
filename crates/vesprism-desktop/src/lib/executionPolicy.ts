/**
 * 工具执行策略：白名单自动放行、黑名单自动拒绝、其余按授权强度审批或沙箱。
 * 评估顺序：黑名单 → 策略 always-proceed → 白名单 → proceed-in-sandbox → 弹出审批。
 */
export type ExecutionPolicy = 'always-proceed' | 'request-review' | 'proceed-in-sandbox'
export type InternetAccess = 'allow' | 'deny' | 'ask'
export type FileAccess = 'workspace-only' | 'unrestricted'
export type PolicyAction = 'allow' | 'deny' | 'review' | 'sandbox'
export type PolicyScope = 'global' | 'workspace'

export type SecurityPolicy = {
  executionPolicy: ExecutionPolicy
  internetAccess: InternetAccess
  fileAccess: FileAccess
  scope: PolicyScope
  cwd: string
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  executionPolicy: 'request-review',
  internetAccess: 'ask',
  fileAccess: 'workspace-only',
  scope: 'global',
  cwd: '',
}

/** 只读 / 低风险开发辅助：整条命令须以此为前缀，且不得含管道/串联 */
export const DEFAULT_ALLOWLIST: string[] = [
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git rev-parse',
  'git show',
  'git remote -v',
  'git describe',
  'git shortlog',
  'cargo check',
  'cargo test',
  'cargo clippy',
  'cargo fmt',
  'npm test',
  'npm run lint',
  'npm run test',
  'npm run typecheck',
  'npx tsc --noEmit',
  'pnpm lint',
  'pnpm test',
  'yarn lint',
  'yarn test',
  'python --version',
  'node --version',
  'rustc --version',
  'go version',
  'pwd',
  'ls',
  'dir',
  'echo',
]

const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*rf?|--recursive)\s+[\\/]/i,
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bRemove-Item\b[\s\S]*-(Recurse|Force)/i,
  /\breg\s+delete\b/i,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b[\s\S]*\|\s*(sh|bash|zsh|cmd|powershell|pwsh)\b/i,
  /\bchmod\s+(-R\s+)?777\s+[\\/]/i,
  /\bInvoke-Expression\b/i,
  /\bdel\s+\/s\b/i,
  /\b(diskpart|cipher\s+\/w)\b/i,
  />\s*\\\\\.\\/i,
]

const NET_PATTERNS: RegExp[] = [
  /\b(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod|npm\s+publish|pip\s+install|cargo\s+publish)\b/i,
]

const COMPOUND_RE = /[;\n]|\|\||&&|\|(?!\|)/

export function normalizeCommand(raw: string): string {
  return (raw || '').replace(/\s+/g, ' ').trim()
}

export function isCompoundCommand(cmd: string): boolean {
  return COMPOUND_RE.test(cmd)
}

export function matchesAllowlist(cmd: string, extra: string[] = []): boolean {
  const c = normalizeCommand(cmd).toLowerCase()
  if (!c || isCompoundCommand(c)) return false
  const list = [...DEFAULT_ALLOWLIST, ...extra].map((s) => s.toLowerCase().trim()).filter(Boolean)
  return list.some((p) => c === p || c.startsWith(`${p} `) || c.startsWith(`${p}\t`))
}

export function matchesDenylist(cmd: string): boolean {
  const c = normalizeCommand(cmd)
  if (!c) return false
  return DENY_PATTERNS.some((re) => re.test(c))
}

export function looksLikeNetwork(cmd: string): boolean {
  return NET_PATTERNS.some((re) => re.test(cmd))
}

export function normPathKey(p: string): string {
  return (p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isAbsoluteFsPath(p: string): boolean {
  const s = (p || '').trim()
  if (!s || s.includes('://')) return false
  if (s.startsWith('/') || s.startsWith('\\')) return true
  return /^[a-zA-Z]:[\\/]/.test(s)
}

function looksLikeFsPath(p: string): boolean {
  const s = (p || '').trim()
  if (!s || s.includes('://')) return false
  if (isAbsoluteFsPath(s)) return true
  if (s.startsWith('./') || s.startsWith('../') || s.startsWith('.\\')) return true
  return s.includes('/') || s.includes('\\')
}

/** 相对工作区、或绝对路径落在 cwd 之下。含 `..` 的会先解析再比。 */
export function isPathInsideWorkspace(target: string, cwd: string): boolean {
  const root = normPathKey(cwd)
  if (!root) return true
  const raw = (target || '').trim()
  if (!raw || raw.includes('://')) return true

  const joinAndResolve = (base: string, rel: string): string => {
    const parts = [...base.split('/').filter(Boolean), ...rel.split('/').filter(Boolean)]
    const stack: string[] = []
    for (const part of parts) {
      if (part === '.' || part === '') continue
      if (part === '..') {
        if (stack.length > 1 || (stack.length === 1 && !/^[a-z]:$/.test(stack[0]))) {
          stack.pop()
        }
        continue
      }
      stack.push(part)
    }
    if (stack.length && /^[a-z]:$/.test(stack[0])) {
      return `${stack[0]}/${stack.slice(1).join('/')}`
    }
    return stack.join('/')
  }

  let resolved: string
  if (isAbsoluteFsPath(raw)) {
    resolved = joinAndResolve('', normPathKey(raw))
  } else {
    resolved = joinAndResolve(root, normPathKey(raw))
  }
  return resolved === root || resolved.startsWith(`${root}/`)
}

function extractPathsFromText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/["']([^"']+)["']/g)) {
    if (looksLikeFsPath(m[1])) out.push(m[1])
  }
  for (const tok of text.split(/\s+/)) {
    const t = tok.replace(/^[`'"]+|[`'"]+$/g, '')
    if (looksLikeFsPath(t)) out.push(t)
  }
  return out
}

function isFileToolKind(kind?: string): boolean {
  const k = (kind || '').toLowerCase()
  return /文件|读取|写入|编辑|删除|移动|file|read|write|edit|delete|move/.test(k)
}

export type PolicyDecision = {
  action: PolicyAction
  reason: string
}

export function evaluatePermission(
  input: { command?: string; kindLabel?: string },
  policy: SecurityPolicy,
): PolicyDecision {
  const cmd = normalizeCommand(input.command || '')
  const cwd = policy.cwd.trim()

  if (policy.fileAccess === 'workspace-only' && cwd) {
    const paths: string[] = []
    if (isFileToolKind(input.kindLabel) && cmd) paths.push(cmd.split('\n')[0].trim())
    paths.push(...extractPathsFromText(cmd))
    for (const p of paths) {
      if (!isPathInsideWorkspace(p, cwd)) {
        return { action: 'deny', reason: `仅允许访问工作区文件（已拦截 ${p}）` }
      }
    }
  }

  if (cmd && matchesDenylist(cmd)) {
    return { action: 'deny', reason: '命中危险命令黑名单，已自动拒绝' }
  }
  if (policy.internetAccess === 'deny' && cmd && looksLikeNetwork(cmd)) {
    return { action: 'deny', reason: '当前策略禁止联网操作' }
  }

  if (policy.executionPolicy === 'always-proceed') {
    return { action: 'allow', reason: '信任模式：自动放行' }
  }

  if (cmd && matchesAllowlist(cmd)) {
    return { action: 'allow', reason: '命中只读/低风险白名单，已自动放行' }
  }

  if (policy.executionPolicy === 'proceed-in-sandbox') {
    return {
      action: 'sandbox',
      reason: '副本模式：已在 git worktree 副本中自动放行（非进程沙箱）',
    }
  }

  return { action: 'review', reason: '需要人工审批' }
}

export function parseExecutionPolicy(v: string | undefined | null): ExecutionPolicy {
  if (v === 'always-proceed' || v === 'proceed-in-sandbox') return v
  return 'request-review'
}

export function parseInternetAccess(v: string | undefined | null): InternetAccess {
  if (v === 'allow' || v === 'deny') return v
  return 'ask'
}

export function parseFileAccess(v: string | undefined | null): FileAccess {
  if (v === 'unrestricted') return v
  return 'workspace-only'
}

export function policyFromDto(raw: {
  execution_policy?: string
  internet_access?: string
  file_access?: string
  scope?: string
  cwd?: string
}): SecurityPolicy {
  return {
    executionPolicy: parseExecutionPolicy(raw.execution_policy),
    internetAccess: parseInternetAccess(raw.internet_access),
    fileAccess: parseFileAccess(raw.file_access),
    scope: raw.scope === 'workspace' ? 'workspace' : 'global',
    cwd: raw.cwd || '',
  }
}
