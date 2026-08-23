/**
 * 插件：官方 x.ai/plugins/list + action。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $activeTabId, $sessionPhase, pushToast } from '../store'
import { sessionExt } from '../bridge'
import { parsePluginList, scopeLabel, type PluginRow } from '../lib/pluginRows'

export function PluginsPanel() {
  const tabId = useStore($activeTabId)
  const ready = useStore($sessionPhase) === 'ready'
  const [rows, setRows] = useState<PluginRow[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [sel, setSel] = useState('')

  const load = useCallback(async () => {
    if (!tabId || !ready) return
    setError('')
    try {
      const raw = await sessionExt(tabId, 'x.ai/plugins/list', {})
      setRows(parsePluginList(raw))
    } catch (e) {
      setError(String(e))
      setRows([])
    }
  }, [tabId, ready])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    )
  }, [rows, query])

  const selected = filtered.find((r) => r.id === sel) || filtered[0]

  const act = async (action: Record<string, unknown>, ok: string) => {
    if (!tabId || busy) return
    setBusy('1')
    try {
      const r = await sessionExt(tabId, 'x.ai/plugins/action', { action })
      const msg = typeof r?.message === 'string' ? r.message : ok
      pushToast(msg, 'success')
      await load()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="work-panel" role="region" aria-label="插件">
      <div className="work-panel-inner">
        <header className="work-panel-head">
          <div>
            <h2 className="work-panel-title">插件</h2>
            <p className="work-panel-desc">
              一套插件可带技能、MCP 和 Hooks。填 GitHub 仓库、git 地址或本地文件夹安装。
            </p>
          </div>
          <div className="work-panel-actions">
            <button type="button" className="skills-btn" onClick={() => void load()} disabled={!ready}>
              刷新
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={!ready || Boolean(busy)}
              onClick={() => void act({ type: 'reload' }, '已重载插件')}
            >
              重载
            </button>
          </div>
        </header>

        <div className="insight-note" style={{ marginBottom: 12 }}>
          <span>安装来源</span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="owner/repo 或 https://…git 或本地路径"
            disabled={!ready}
          />
        </div>
        <div className="insight-actions" style={{ marginBottom: 16, justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="insight-btn is-primary"
            disabled={!ready || !source.trim() || Boolean(busy)}
            onClick={() => void act({ type: 'install', source: source.trim() }, '已开始安装')}
          >
            安装
          </button>
        </div>

        {error ? <p className="work-error">{error}</p> : null}

        <div className="work-split">
          <div className="work-list">
            <input
              className="work-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索插件"
            />
            {filtered.length === 0 ? (
              <p className="work-empty">{ready ? '还没有已装插件。' : '会话未就绪。'}</p>
            ) : (
              <ul className="work-rows">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`work-row${selected?.id === r.id ? ' is-on' : ''}`}
                      onClick={() => setSel(r.id)}
                    >
                      <span className="work-chip">{r.enabled ? '开' : '关'}</span>
                      <span>
                        <span className="work-row-title">{r.name}</span>
                        <div className="work-row-sub">
                          {scopeLabel(r.scope)}
                          {r.skillCount ? ` · ${r.skillCount} 技能` : ''}
                          {r.mcpCount ? ` · ${r.mcpCount} MCP` : ''}
                        </div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="work-preview">
            {selected ? (
              <>
                <p className="work-row-title">{selected.name}</p>
                <p className="work-row-sub" style={{ margin: '6px 0 12px' }}>
                  {selected.description || selected.id}
                  {selected.version ? ` · v${selected.version}` : ''}
                </p>
                <div className="work-panel-actions">
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        {
                          type: selected.enabled ? 'disable' : 'enable',
                          pluginId: selected.id,
                        },
                        selected.enabled ? '已停用' : '已启用',
                      )
                    }
                  >
                    {selected.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act({ type: 'update', pluginId: selected.id }, '正在更新')
                    }
                  >
                    更新
                  </button>
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        { type: 'uninstall', pluginId: selected.id, confirmed: true },
                        '已卸载',
                      )
                    }
                  >
                    卸载
                  </button>
                </div>
              </>
            ) : (
              <p className="work-empty">选左侧插件查看操作。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
