/**
 * 工具面板 — 展示当前会话可用工具（官方 x.ai/commands/list.tools）
 * 并可查看斜杠命令摘要；MCP 工具名（server__tool）单独分组。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { $activeTabId, $shellReady, pushToast } from '../store'
import { listSessionCommands } from '../bridge'
import {
  CATEGORY_LABEL,
  categoryOrder,
  enrichToolName,
  type ToolCategory,
  type ToolMeta,
} from '../lib/toolCatalog'

type SlashCmd = { name: string; description: string }

export function ToolsPanel() {
  const tabId = useStore($activeTabId)
  const ready = useStore($shellReady)
  const [tools, setTools] = useState<ToolMeta[]>([])
  const [commands, setCommands] = useState<SlashCmd[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'tools' | 'commands'>('tools')
  const [catFilter, setCatFilter] = useState<ToolCategory | 'all'>('all')

  const load = useCallback(async () => {
    if (!tabId) return
    setLoading(true)
    setError('')
    try {
      const resp = await listSessionCommands(tabId)
      const toolNames = Array.isArray(resp?.tools)
        ? resp.tools.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : []
      setTools(toolNames.map(enrichToolName).sort((a, b) => a.name.localeCompare(b.name)))

      const cmds = Array.isArray(resp?.commands)
        ? resp.commands
            .map((c) => ({
              name: String(c?.name || '').replace(/^\//, ''),
              description: String(c?.description || '').trim(),
            }))
            .filter((c) => c.name)
        : []
      setCommands(cmds)
    } catch (e) {
      setError(String(e))
      setTools([])
      setCommands([])
    } finally {
      setLoading(false)
    }
  }, [tabId])

  useEffect(() => {
    if (!tabId) return
    void load()
  }, [tabId, load])

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tools.filter((t) => {
      if (catFilter !== 'all' && t.category !== catFilter) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    })
  }, [tools, query, catFilter])

  const grouped = useMemo(() => {
    const map = new Map<ToolCategory, ToolMeta[]>()
    for (const t of filteredTools) {
      const list = map.get(t.category) || []
      list.push(t)
      map.set(t.category, list)
    }
    return categoryOrder()
      .filter((c) => map.has(c))
      .map((c) => ({ category: c, items: map.get(c)! }))
  }, [filteredTools])

  const filteredCmds = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    )
  }, [commands, query])

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
      pushToast(`已复制 ${name}`, 'success')
    } catch {
      pushToast('复制失败', 'error')
    }
  }

  const catsPresent = useMemo(() => {
    const s = new Set(tools.map((t) => t.category))
    return categoryOrder().filter((c) => s.has(c))
  }, [tools])

  return (
    <div className="tools-panel" role="region" aria-label="工具">
      <div className="tools-panel-inner">
        <header className="tools-panel-head">
          <div className="tools-panel-titles">
            <h2 className="tools-panel-title">工具</h2>
            <p className="tools-panel-desc">
              当前会话 Agent 可用的工具清单（官方{' '}
              <code>x.ai/commands/list</code> → <code>tools</code>）。
              模型会按需调用，无需在此手动执行。
            </p>
          </div>
          <div className="tools-panel-actions">
            <span className="tools-panel-stats">
              {tools.length} 工具 · {commands.length} 命令
            </span>
            <button
              type="button"
              className="tools-btn"
              disabled={loading || !ready || !tabId}
              onClick={() => void load()}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </header>

        <div className="tools-toolbar">
          <div className="tools-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tools'}
              className={`tools-tab${tab === 'tools' ? ' is-active' : ''}`}
              onClick={() => setTab('tools')}
            >
              工具 ({tools.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'commands'}
              className={`tools-tab${tab === 'commands' ? ' is-active' : ''}`}
              onClick={() => setTab('commands')}
            >
              斜杠命令 ({commands.length})
            </button>
          </div>
          <input
            className="tools-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'tools' ? '搜索工具名 / 说明…' : '搜索命令…'}
          />
        </div>

        {tab === 'tools' && catsPresent.length > 0 ? (
          <div className="tools-cat-row">
            <button
              type="button"
              className={`tools-cat-chip${catFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setCatFilter('all')}
            >
              全部
            </button>
            {catsPresent.map((c) => (
              <button
                key={c}
                type="button"
                className={`tools-cat-chip${catFilter === c ? ' is-active' : ''}`}
                onClick={() => setCatFilter(c)}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="tools-error" role="alert">
            {error}
            <button type="button" className="tools-btn" onClick={() => void load()}>
              重试
            </button>
          </div>
        ) : loading && tools.length === 0 && commands.length === 0 ? (
          <div className="tools-empty">加载中…</div>
        ) : tab === 'tools' ? (
          filteredTools.length === 0 ? (
            <div className="tools-empty">
              {tools.length === 0
                ? '当前无可用工具。可点刷新重试，或先在普通对话里完成一次会话初始化。'
                : '没有匹配的工具。'}
            </div>
          ) : (
            <div className="tools-groups">
              {grouped.map(({ category, items }) => (
                <section key={category} className="tools-group">
                  <h3 className="tools-group-title">
                    {CATEGORY_LABEL[category]}
                    <span className="tools-group-count">{items.length}</span>
                  </h3>
                  <ul className="tools-list">
                    {items.map((t) => (
                      <li key={t.name} className="tools-card">
                        <div className="tools-card-main">
                          <div className="tools-card-titles">
                            <span className="tools-card-label">{t.label}</span>
                            <code className="tools-card-name">{t.name}</code>
                          </div>
                          <p className="tools-card-desc">{t.description}</p>
                          <div className="tools-card-meta">
                            {t.readOnly ? (
                              <span className="tools-pill readonly">只读</span>
                            ) : (
                              <span className="tools-pill write">可写</span>
                            )}
                            <span className="tools-pill cat">
                              {CATEGORY_LABEL[t.category]}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="tools-btn ghost"
                          onClick={() => void copyName(t.name)}
                          title="复制工具名"
                        >
                          复制
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )
        ) : filteredCmds.length === 0 ? (
          <div className="tools-empty">
            {commands.length === 0 ? '暂无斜杠命令。' : '没有匹配的命令。'}
          </div>
        ) : (
          <ul className="tools-list">
            {filteredCmds.map((c) => (
              <li key={c.name} className="tools-card">
                <div className="tools-card-main">
                  <div className="tools-card-titles">
                    <code className="tools-card-name">/{c.name}</code>
                  </div>
                  {c.description ? (
                    <p className="tools-card-desc">{c.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="tools-btn ghost"
                  onClick={() => void copyName(`/${c.name}`)}
                >
                  复制
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
