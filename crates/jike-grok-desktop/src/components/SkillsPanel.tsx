/**
 * 技能面板 — 官方 x.ai/commands/list（cwd 发现）
 * 技能命令带 meta.scope + meta.path；可复制 /name 并写入输入框。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  $activeTabId,
  $composerInput,
  $utilityKind,
  $workspaceCwd,
  patchActiveTab,
  pushToast,
} from '../store'
import { listSessionCommands } from '../bridge'
import { zhCommandLabel, zhCommandPurpose } from '../lib/toolChinese'

export type SkillRow = {
  name: string
  displayName: string
  description: string
  scope: string
  path: string
  plugin?: string
  argumentHint?: string
}

const SCOPE_LABEL: Record<string, string> = {
  local: '本地 (cwd)',
  repo: '仓库',
  user: '用户',
  server: '服务器',
  bundled: '内置',
  plugin: '插件',
}

function metaOf(cmd: {
  meta?: Record<string, unknown> | null
  _meta?: Record<string, unknown> | null
}): Record<string, unknown> | null {
  const m = cmd.meta ?? cmd._meta
  return m && typeof m === 'object' ? m : null
}

function parseSkills(
  commands: Array<{
    name?: string
    description?: string
    input?: unknown
    meta?: Record<string, unknown> | null
    _meta?: Record<string, unknown> | null
  }>,
): SkillRow[] {
  const out: SkillRow[] = []
  for (const c of commands) {
    const meta = metaOf(c)
    if (!meta) continue
    const path = String(meta.path ?? '').trim()
    const scope = String(meta.scope ?? '').trim().toLowerCase()
    // 官方技能：同时有 scope + path；工作流另有 workflowPath，跳过
    if (!path || !scope) continue
    if (meta.workflowPath || meta.workflowSource) continue
    const name = String(c.name || '').replace(/^\//, '').trim()
    if (!name) continue
    const displayName = String(meta.displayName ?? meta.display_name ?? name)
    // 用途说明：优先命令 description，其次 meta 里的 short/when_to_use
    const description = String(
      c.description ||
        meta.short_description ||
        meta.shortDescription ||
        meta.when_to_use ||
        meta.whenToUse ||
        meta.description ||
        '',
    ).trim()
    let argumentHint = ''
    const input = c.input as
      | { hint?: string; unstructured?: { hint?: string } }
      | undefined
    if (input && typeof input === 'object') {
      argumentHint = String(
        input.hint ?? input.unstructured?.hint ?? '',
      ).trim()
    }
    out.push({
      name,
      displayName,
      description:
        description ||
        `技能「${displayName}」—— 在对话中输入 /${name} 可调用`,
      scope,
      path,
      plugin: meta.plugin ? String(meta.plugin) : undefined,
      argumentHint: argumentHint || undefined,
    })
  }
  out.sort((a, b) => {
    const sa = scopeRank(a.scope) - scopeRank(b.scope)
    if (sa !== 0) return sa
    return a.name.localeCompare(b.name)
  })
  return out
}

function scopeRank(s: string): number {
  const order = ['local', 'repo', 'user', 'server', 'bundled', 'plugin']
  const i = order.indexOf(s)
  return i < 0 ? 99 : i
}

export function SkillsPanel() {
  const tabId = useStore($activeTabId)
  const cwd = useStore($workspaceCwd)
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<string | 'all'>('all')

  const load = useCallback(async () => {
    if (!tabId) return
    setLoading(true)
    setError('')
    try {
      const resp = await listSessionCommands(tabId, cwd || undefined)
      const cmds = Array.isArray(resp?.commands) ? resp.commands : []
      setSkills(parseSkills(cmds))
    } catch (e) {
      setError(String(e))
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [tabId, cwd])

  useEffect(() => {
    if (!tabId) return
    void load()
  }, [tabId, load])

  const scopesPresent = useMemo(() => {
    const s = new Set(skills.map((x) => x.scope))
    return ['local', 'repo', 'user', 'server', 'bundled', 'plugin'].filter((x) =>
      s.has(x),
    )
  }, [skills])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter((sk) => {
      if (scopeFilter !== 'all' && sk.scope !== scopeFilter) return false
      if (!q) return true
      return (
        sk.name.toLowerCase().includes(q) ||
        sk.displayName.toLowerCase().includes(q) ||
        sk.description.toLowerCase().includes(q) ||
        sk.path.toLowerCase().includes(q)
      )
    })
  }, [skills, query, scopeFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, SkillRow[]>()
    for (const sk of filtered) {
      const list = map.get(sk.scope) || []
      list.push(sk)
      map.set(sk.scope, list)
    }
    return ['local', 'repo', 'user', 'server', 'bundled', 'plugin', ...map.keys()]
      .filter((k, i, arr) => map.has(k) && arr.indexOf(k) === i)
      .map((scope) => ({ scope, items: map.get(scope)! }))
  }, [filtered])

  const copySlash = async (name: string) => {
    const text = `/${name}`
    try {
      await navigator.clipboard.writeText(text)
      pushToast(`已复制 ${text}`, 'success')
    } catch {
      pushToast('复制失败', 'error')
    }
  }

  /** 填入输入框并退出专用面板（勿命名 use*，避免 hooks lint） */
  const fillInChat = (name: string, _hint?: string) => {
    $composerInput.set(`/${name} `)
    patchActiveTab({ utilityKind: null, chatTitle: '' })
    $utilityKind.set(null)
    pushToast(`已填入 /${name}，可补充参数后发送`, 'success')
  }

  return (
    <div className="skills-panel" role="region" aria-label="技能">
      <div className="skills-panel-inner">
        <header className="skills-panel-head">
          <div className="skills-panel-titles">
            <h2 className="skills-panel-title">技能</h2>
            <p className="skills-panel-desc">
              可复用的提示包。每条下方的<strong>用途</strong>说明该技能做什么；
              对话中输入 <code>/技能名</code> 即可调用。
            </p>
          </div>
          <div className="skills-panel-actions">
            <span className="skills-panel-stats">{skills.length} 个技能</span>
            <button
              type="button"
              className="skills-btn"
              disabled={loading || !tabId}
              onClick={() => void load()}
            >
              {loading ? '扫描中…' : '刷新'}
            </button>
          </div>
        </header>

        <div className="skills-toolbar">
          <input
            className="skills-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称 / 用途…"
          />
        </div>

        {scopesPresent.length > 0 ? (
          <div className="skills-scope-row">
            <button
              type="button"
              className={`skills-scope-chip${scopeFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setScopeFilter('all')}
            >
              全部
            </button>
            {scopesPresent.map((s) => (
              <button
                key={s}
                type="button"
                className={`skills-scope-chip${scopeFilter === s ? ' is-active' : ''}`}
                onClick={() => setScopeFilter(s)}
              >
                {SCOPE_LABEL[s] || s}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="skills-error" role="alert">
            {error}
            <button
              type="button"
              className="skills-btn"
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        ) : loading && skills.length === 0 ? (
          <div className="skills-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="skills-empty">
            {skills.length === 0
              ? '当前未发现技能。在 .grok/skills/<名称>/SKILL.md 中配置后点刷新；frontmatter 的 description 会显示为「用途」。'
              : '没有匹配的技能。'}
          </div>
        ) : (
          <div className="skills-groups">
            {grouped.map(({ scope, items }) => (
              <section key={scope} className="skills-group">
                <h3 className="skills-group-title">
                  {SCOPE_LABEL[scope] || scope}
                  <span className="skills-group-count">{items.length}</span>
                </h3>
                <ul className="skills-list">
                  {items.map((sk) => (
                    <li
                      key={`${sk.scope}:${sk.path}:${sk.name}`}
                      className="skills-card"
                    >
                      <div className="skills-card-main">
                        <div className="skills-card-titles">
                          <span className="skills-card-label">
                            {sk.displayName}
                          </span>
                          <code className="skills-card-slash">/{sk.name}</code>
                          {zhCommandLabel(sk.name) ? (
                            <span className="zh-label">{zhCommandLabel(sk.name)}</span>
                          ) : null}
                          <span className={`skills-pill scope-${sk.scope}`}>
                            {SCOPE_LABEL[sk.scope] || sk.scope}
                          </span>
                          {sk.plugin ? (
                            <span className="skills-pill">
                              plugin:{sk.plugin}
                            </span>
                          ) : null}
                        </div>
                        {/* 用途：该技能是干什么的（来自 SKILL.md description） */}
                        <p className="skills-card-purpose">
                          <span className="skills-card-purpose-label">用途</span>
                          <span className="skills-card-purpose-text">
                            {zhCommandPurpose(sk.name) ?? sk.description}
                          </span>
                        </p>
                        <div className="skills-card-path" title={sk.path}>
                          {sk.path}
                        </div>
                        {sk.argumentHint ? (
                          <div className="skills-card-hint">
                            参数：{sk.argumentHint}
                          </div>
                        ) : null}
                      </div>
                      <div className="skills-card-ops">
                        <button
                          type="button"
                          className="skills-btn ghost"
                          onClick={() => void copySlash(sk.name)}
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          className="skills-btn primary"
                          onClick={() => fillInChat(sk.name, sk.argumentHint)}
                          title="填入输入框并回到对话"
                        >
                          使用
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
