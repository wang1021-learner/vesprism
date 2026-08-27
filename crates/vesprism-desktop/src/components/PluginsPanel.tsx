/**
 * 插件：一整包扩展（技能 / MCP / Hooks）。启停写入本机配置。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { $workspaceCwd, pushToast } from '../store'
import { useStore } from '@nanostores/react'
import { codingSessionReady, useCodingSessionTabId } from '../lib/codingSession'
import { listCatalogPlugins, pluginsAction, pluginsList } from '../bridge'
import { parsePluginList, pluginStatusLabel, scopeLabel, type PluginRow } from '../lib/pluginRows'
import { formatEngineError } from '../lib/errorMessage'
import { MarketplaceStore } from './MarketplaceStore'
import { Notice } from './Notice'

export function PluginsPanel() {
  const tabId = useCodingSessionTabId()
  const ready = codingSessionReady(tabId)
  const cwd = useStore($workspaceCwd)
  const [rows, setRows] = useState<PluginRow[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [sel, setSel] = useState('')
  const [confirmUninstall, setConfirmUninstall] = useState('')
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [pane, setPane] = useState<'installed' | 'store'>('installed')

  const load = useCallback(async () => {
    setError('')
    try {
      if (tabId && ready) {
        try {
          const raw = await pluginsList(tabId)
          const next = parsePluginList(raw)
          if (next.length) {
            setRows(next)
            return
          }
        } catch {
          /* 无会话时扫磁盘 */
        }
      }
      const cat = await listCatalogPlugins(cwd || null)
      setRows(parsePluginList(cat))
    } catch (e) {
      setError(formatEngineError(e))
      setRows([])
    }
  }, [tabId, ready, cwd])

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
      const r = await pluginsAction(tabId, action)
      const msg = typeof r?.message === 'string' ? r.message : ok
      pushToast(msg, 'success')
      await load()
    } catch (e) {
      pushToast(formatEngineError(e), 'error')
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
              一整箱扩展，里面可以带技能、MCP 和 Hooks。启停写入本机配置，之后
              <strong>所有对话</strong>
              都不再加载它。商店安装会写到本机目录，要确认来源路径；默认不自动启用。
            </p>
          </div>
          <div className="work-panel-actions">
            <button
              type="button"
              className={`skills-btn${pane === 'installed' ? ' is-on' : ''}`}
              onClick={() => setPane('installed')}
            >
              已装
            </button>
            <button
              type="button"
              className={`skills-btn${pane === 'store' ? ' is-on' : ''}`}
              onClick={() => setPane('store')}
            >
              商店
            </button>
            <button
              type="button"
              className="skills-btn"
              title="重新拉取已装列表"
              onClick={() => void load()}
            >
              刷新列表
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={!ready || Boolean(busy)}
              title="让引擎把已装插件再加载一遍，不重新下载"
              onClick={() => void act({ type: 'reload' }, '已让引擎重新加载插件')}
            >
              重新加载
            </button>
          </div>
        </header>

        {pane === 'store' ? (
          <MarketplaceStore
            tabId={tabId}
            ready={ready}
            busy={busy}
            setBusy={setBusy}
            onInstalled={() => void load()}
          />
        ) : (
          <>
        {!ready ? (
          <p className="memory-banner" role="status">
            安装、启停、卸载需要先在编码里开一场对话。下面仍可浏览已装列表。
          </p>
        ) : null}

        <p className="skills-add-hint">
          填 GitHub 的 <code>owner/repo</code>、git 地址，或本机文件夹。装到本机后，技能会出现在「技能」页，MCP
          会出现在「MCP」页。
        </p>
        <div className="insight-note" style={{ marginBottom: 12 }}>
          <span>安装来源</span>
          <input
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setConfirmInstall(false)
            }}
            placeholder="owner/repo 或 git 地址或本地文件夹"
            disabled={!ready}
          />
        </div>
        <div className="insight-actions" style={{ marginBottom: 16, justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="insight-btn is-primary"
            disabled={!ready || !source.trim() || Boolean(busy)}
            onClick={() => {
              if (!confirmInstall) {
                setConfirmInstall(true)
                return
              }
              setConfirmInstall(false)
              void act({ type: 'install', source: source.trim() }, '已开始安装')
            }}
          >
            {confirmInstall ? `再点确认：安装 ${source.trim()}` : '安装'}
          </button>
        </div>

        {error ? (
          <Notice
            tone="error"
            action={
              <button type="button" className="notice-action" onClick={() => void load()}>
                重试
              </button>
            }
          >
            {error}
          </Notice>
        ) : null}

        <div className="work-split">
          <div className="work-list">
            <input
              className="work-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索插件"
            />
            {filtered.length === 0 ? (
              <p className="work-empty">
                {rows.length === 0
                  ? ready
                    ? '还没有已装插件。用上面的来源安装。'
                    : '还没有已装插件。先开一场编码对话再安装。'
                  : '没有匹配的插件。'}
              </p>
            ) : (
              <ul className="work-rows">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`work-row${selected?.id === r.id ? ' is-on' : ''}`}
                      onClick={() => {
                        setSel(r.id)
                        setConfirmUninstall('')
                      }}
                    >
                      <span className="work-chip">{r.enabled ? '已启用' : '已停用'}</span>
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
                {selected.root ? (
                  <p className="work-row-sub" style={{ margin: '0 0 12px' }}>
                    路径：{selected.root}
                    {selected.hookCount
                      ? ` · Hooks ${pluginStatusLabel(selected.hookStatus)}`
                      : ''}
                    {selected.mcpCount
                      ? ` · MCP ${pluginStatusLabel(selected.mcpStatus)}`
                      : ''}
                  </p>
                ) : null}
                <div className="work-panel-actions">
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={!ready || Boolean(busy)}
                    title={
                      selected.enabled
                        ? '停用后写入本机配置，之后所有对话都不会加载这箱插件'
                        : '启用后之后的对话会加载这箱插件'
                    }
                    onClick={() =>
                      void act(
                        {
                          type: selected.enabled ? 'disable' : 'enable',
                          pluginId: selected.id,
                        },
                        selected.enabled
                          ? '已停用插件（本机配置，之后的对话都不加载）'
                          : '已启用插件',
                      )
                    }
                  >
                    {selected.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={!ready || Boolean(busy)}
                    title="向来源拉更新"
                    onClick={() =>
                      void act({ type: 'update', pluginId: selected.id }, '正在更新')
                    }
                  >
                    更新
                  </button>
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={!ready || Boolean(busy)}
                    title="从本机卸掉这箱插件，技能和 MCP 会一起没"
                    onClick={() => {
                      if (confirmUninstall !== selected.id) {
                        setConfirmUninstall(selected.id)
                        return
                      }
                      setConfirmUninstall('')
                      void act(
                        {
                          type: 'uninstall',
                          pluginId: selected.id,
                          confirmed: true,
                        },
                        '已卸载',
                      )
                    }}
                  >
                    {confirmUninstall === selected.id
                      ? '再点确认：卸载这箱插件'
                      : '卸载'}
                  </button>
                </div>
              </>
            ) : (
              <p className="work-empty">选左侧插件查看操作。</p>
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  )
}
