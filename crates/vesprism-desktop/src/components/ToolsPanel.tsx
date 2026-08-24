/**
 * 工具面板 — 当前会话可用工具（官方 x.ai/commands/list.tools）
 * 停用走组装单 tools.disable；斜杠命令可填入输入框。MCP 工具默认折叠。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  $activeSessionId,
  $composerInput,
  $tabs,
  $utilityKind,
  $workspaceCwd,
  patchActiveTab,
  pushToast,
} from '../store'
import { codingSessionReady, useCodingSessionTabId } from '../lib/codingSession'
import { getComposition, listSessionCommands } from '../bridge'
import {
  CATEGORY_LABEL,
  builtinToolCatalog,
  categoryOrder,
  enrichToolName,
  type ToolCategory,
  type ToolMeta,
} from '../lib/toolCatalog'
import { zhCommandLabel, zhCommandPurpose, zhToolLabel } from '../lib/toolChinese'
import {
  canDisableTool,
  listChatSessionTargets,
  mergeComposition,
  setChatToolsDisabled,
} from '../lib/toolDisable'
import { parseOfficialCommands, type ComposerCommand } from '../lib/composerCommands'

const KIND_LABEL: Record<string, string> = {
  skill: '技能',
  workflow: '工作流',
  command: '命令',
}

export function ToolsPanel() {
  const tabId = useCodingSessionTabId()
  const sessionId = useStore($activeSessionId)
  const cwd = useStore($workspaceCwd)
  const ready = codingSessionReady(tabId)
  const tabs = useStore($tabs)
  const chatCount = useMemo(
    () => listChatSessionTargets(cwd || '').length,
    [cwd, tabs],
  )
  const [tools, setTools] = useState<ToolMeta[]>([])
  const [commands, setCommands] = useState<ComposerCommand[]>([])
  const [disabled, setDisabled] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'tools' | 'commands'>('tools')
  const [catFilter, setCatFilter] = useState<ToolCategory | 'all'>('all')
  const [showMcp, setShowMcp] = useState(false)
  const [busyTool, setBusyTool] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const catalog = [...builtinToolCatalog()]
    try {
      const chats = listChatSessionTargets(cwd || '')
      const listTab = chats[0]?.tabId || tabId
      const compSession = chats[0]?.sessionId || sessionId || null
      const compCwd = chats[0]?.cwd || cwd || ''
      const comp = await getComposition(compSession, compCwd).catch(() => null)
      const disable = mergeComposition(comp).tools.disable
      setDisabled(disable)

      let extra: string[] = []
      let cmds: Parameters<typeof parseOfficialCommands>[0] = []
      if (listTab && ready) {
        try {
          const resp = await listSessionCommands(listTab)
          extra = Array.isArray(resp?.tools)
            ? resp.tools.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            : []
          cmds = resp?.commands ?? []
        } catch {
          /* 无会话时只展示内置目录 */
        }
      }
      const seen = new Set(catalog.map((t) => t.name))
      const listed = [...catalog]
      for (const name of [...extra, ...disable]) {
        if (!seen.has(name)) {
          listed.push(enrichToolName(name))
          seen.add(name)
        }
      }
      setTools(listed.sort((a, b) => a.name.localeCompare(b.name)))
      setCommands(parseOfficialCommands(cmds))
    } catch (e) {
      setError(String(e))
      setTools(catalog)
      setCommands([])
    } finally {
      setLoading(false)
    }
  }, [tabId, sessionId, cwd, ready])

  useEffect(() => {
    void load()
  }, [load])

  const disabledSet = useMemo(() => new Set(disabled), [disabled])

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tools.filter((t) => {
      if (!showMcp && t.category === 'mcp') return false
      if (catFilter !== 'all' && t.category !== catFilter) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    })
  }, [tools, query, catFilter, showMcp])

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
        c.label.toLowerCase().includes(q) ||
        c.hint.toLowerCase().includes(q),
    )
  }, [commands, query])

  const mcpCount = useMemo(
    () => tools.filter((t) => t.category === 'mcp').length,
    [tools],
  )

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
      pushToast(`已复制 ${name}`, 'success')
    } catch {
      pushToast('复制失败', 'error')
    }
  }

  const fillCommand = (cmd: ComposerCommand) => {
    $composerInput.set(cmd.insert)
    patchActiveTab({ utilityKind: null, chatTitle: '' })
    $utilityKind.set(null)
    pushToast(`已填入 ${cmd.label}`, 'success')
  }

  const onToggleDisable = async (name: string) => {
    if (!tabId || busyTool) return
    const nextDisabled = !disabledSet.has(name)
    setBusyTool(name)
    try {
      const { disable, count } = await setChatToolsDisabled(
        cwd || '',
        name,
        nextDisabled,
      )
      setDisabled(disable)
      pushToast(
        nextDisabled
          ? `已在 ${count} 个对话停用 ${name}`
          : `已在 ${count} 个对话启用 ${name}`,
        'success',
      )
      await load()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyTool('')
    }
  }

  const catsPresent = useMemo(() => {
    const s = new Set(
      tools
        .filter((t) => showMcp || t.category !== 'mcp')
        .map((t) => t.category),
    )
    return categoryOrder().filter((c) => s.has(c))
  }, [tools, showMcp])

  return (
    <div className="tools-panel" role="region" aria-label="工具">
      <div className="tools-panel-inner">
        <header className="tools-panel-head">
          <div className="tools-panel-titles">
            <h2 className="tools-panel-title">工具</h2>
            <p className="tools-panel-desc">
              模型按需调用，不必在此手动执行。停用写入同一工作区对话的组装单{' '}
              <code>tools.disable</code>，不影响这个工具页自己。
            </p>
          </div>
          <div className="tools-panel-actions">
            <span className="tools-panel-stats">
              {tools.length} 工具
              {disabled.length > 0 ? ` · ${disabled.length} 已停用` : ''}
              {' · '}
              {commands.length} 命令
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

        {tab === 'tools' && (catsPresent.length > 0 || mcpCount > 0) ? (
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
            {mcpCount > 0 ? (
              <button
                type="button"
                className={`tools-cat-chip${showMcp ? ' is-active' : ''}`}
                onClick={() => {
                  setShowMcp((v) => !v)
                  if (!showMcp) setCatFilter('mcp')
                  else if (catFilter === 'mcp') setCatFilter('all')
                }}
              >
                MCP ({mcpCount})
              </button>
            ) : null}
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
                    {items.map((t) => {
                      const off = disabledSet.has(t.name)
                      return (
                        <li
                          key={t.name}
                          className={`tools-card${off ? ' is-disabled' : ''}`}
                        >
                          <div className="tools-card-main">
                            <div className="tools-card-titles">
                              <span className="tools-card-label">{t.label}</span>
                              <code className="tools-card-name">{t.name}</code>
                              {zhToolLabel(t.name) ? (
                                <span className="zh-label">{zhToolLabel(t.name)}</span>
                              ) : null}
                              {off ? (
                                <span className="tools-pill is-off">已停用</span>
                              ) : null}
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
                          <div className="tools-card-ops">
                            {canDisableTool(t.name) ? (
                              <button
                                type="button"
                                className="tools-btn ghost"
                                disabled={busyTool === t.name || !tabId || chatCount === 0}
                                title={
                                  chatCount === 0
                                    ? '请先打开一个对话再停用工具'
                                    : off
                                      ? '在同一工作区的对话里重新启用'
                                      : '在同一工作区的对话里停用（组装单 tools.disable）'
                                }
                                onClick={() => void onToggleDisable(t.name)}
                              >
                                {off ? '启用' : '停用'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="tools-btn ghost"
                              onClick={() => void copyName(t.name)}
                              title="复制工具名"
                            >
                              复制
                            </button>
                          </div>
                        </li>
                      )
                    })}
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
              <li key={c.id} className="tools-card">
                <div className="tools-card-main">
                  <div className="tools-card-titles">
                    <code className="tools-card-name">{c.label}</code>
                    <span className="tools-pill">{KIND_LABEL[c.kind || 'command']}</span>
                    {zhCommandLabel(c.label.slice(1)) ? (
                      <span className="zh-label">{zhCommandLabel(c.label.slice(1))}</span>
                    ) : null}
                  </div>
                  {c.hint ? (
                    <p className="tools-card-desc">
                      {zhCommandPurpose(c.label.slice(1)) ?? c.hint}
                    </p>
                  ) : null}
                </div>
                <div className="tools-card-ops">
                  <button
                    type="button"
                    className="tools-btn ghost"
                    onClick={() => void copyName(c.label)}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="tools-btn ghost"
                    onClick={() => fillCommand(c)}
                    title="填入输入框并回到对话"
                  >
                    使用
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
