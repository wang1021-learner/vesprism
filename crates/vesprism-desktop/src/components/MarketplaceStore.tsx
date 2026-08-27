/**
 * 官方商店目录：x.ai/marketplace/list + action。
 * 安装会往本机写技能/MCP/Hooks；要确认，并展示来源路径。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { marketplaceAction, marketplaceList } from '../bridge'
import { formatEngineError } from '../lib/errorMessage'
import {
  installStatusLabel,
  parseMarketplaceList,
  type MarketplacePlugin,
  type MarketplaceSource,
} from '../lib/marketplaceRows'
import { pushToast } from '../store'
import { Notice } from './Notice'

function pluginKey(p: MarketplacePlugin): string {
  return `${p.sourceUrl}::${p.relativePath || p.name}`
}

export function MarketplaceStore({
  tabId,
  ready,
  busy,
  setBusy,
  onInstalled,
}: {
  tabId: string
  ready: boolean
  busy: string
  setBusy: (v: string) => void
  onInstalled: () => void
}) {
  const [sources, setSources] = useState<MarketplaceSource[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState('')
  const [confirmKey, setConfirmKey] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!tabId || !ready) return
    setError('')
    setLoading(true)
    try {
      const raw = await marketplaceList(tabId)
      setSources(parseMarketplaceList(raw))
    } catch (e) {
      setError(formatEngineError(e))
      setSources([])
    } finally {
      setLoading(false)
    }
  }, [tabId, ready])

  useEffect(() => {
    void load()
  }, [load])

  const plugins = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows: MarketplacePlugin[] = []
    for (const s of sources) {
      for (const p of s.plugins) {
        if (
          q &&
          !p.name.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q) &&
          !p.sourceName.toLowerCase().includes(q)
        ) {
          continue
        }
        rows.push(p)
      }
    }
    return rows
  }, [sources, query])

  const selected = plugins.find((p) => pluginKey(p) === sel) || plugins[0]

  const act = async (action: Record<string, unknown>, ok: string) => {
    if (!tabId || busy) return
    setBusy('store')
    try {
      const r = await marketplaceAction(tabId, action)
      const msg = typeof r?.message === 'string' ? r.message : ok
      pushToast(msg, 'success')
      setConfirmKey('')
      await load()
      onInstalled()
    } catch (e) {
      pushToast(formatEngineError(e), 'error')
    } finally {
      setBusy('')
    }
  }

  if (!ready) {
    return (
      <p className="memory-banner" role="status">
        浏览商店、安装插件需要先在编码里开一场对话。
      </p>
    )
  }

  return (
    <div>
      <p className="skills-add-hint">
        安装会把技能、MCP、Hooks 写到本机目录，下次会话自动加载。默认不信任、不自动启用；装完请到左侧已装列表按需启用。来源和相对路径会在确认时展示。
      </p>
      <div className="work-panel-actions" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="skills-btn"
          disabled={Boolean(busy)}
          onClick={() => void load()}
        >
          刷新目录
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
      {sources.some((s) => s.error) ? (
        <Notice tone="warning">
          {sources
            .filter((s) => s.error)
            .map((s) => `${s.name}：${s.error}`)
            .join('；')}
        </Notice>
      ) : null}
      <div className="work-split">
        <div className="work-list">
          <input
            className="work-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索商店插件"
          />
          {loading ? (
            <p className="work-empty">正在扫描商店目录…</p>
          ) : plugins.length === 0 ? (
            <p className="work-empty">
              {sources.length === 0 ? '商店目录是空的。' : '没有匹配的插件。'}
            </p>
          ) : (
            <ul className="work-rows">
              {plugins.map((p) => {
                const key = pluginKey(p)
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={`work-row${selected && pluginKey(selected) === key ? ' is-on' : ''}`}
                      onClick={() => {
                        setSel(key)
                        setConfirmKey('')
                      }}
                    >
                      <span className="work-chip">{installStatusLabel(p.installStatus)}</span>
                      <span>
                        <span className="work-row-title">{p.name}</span>
                        <div className="work-row-sub">
                          {p.sourceName}
                          {p.skillCount ? ` · ${p.skillCount} 技能` : ''}
                          {p.hasMcp ? ' · MCP' : ''}
                          {p.hasHooks ? ' · Hooks' : ''}
                        </div>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="work-preview">
          {selected ? (
            <>
              <p className="work-row-title">{selected.name}</p>
              <p className="work-row-sub" style={{ margin: '6px 0 12px' }}>
                {selected.description || '无说明'}
                {selected.version ? ` · v${selected.version}` : ''}
                {selected.author ? ` · ${selected.author}` : ''}
              </p>
              <p className="work-row-sub" style={{ marginBottom: 12 }}>
                来源：{selected.sourceUrl || selected.sourceName || '（未知）'}
                <br />
                路径：{selected.relativePath || selected.name}
              </p>
              <div className="work-panel-actions">
                {selected.installStatus === 'not_installed' ? (
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={Boolean(busy) || !selected.sourceUrl || !selected.relativePath}
                    onClick={() => {
                      const key = pluginKey(selected)
                      if (confirmKey !== key) {
                        setConfirmKey(key)
                        return
                      }
                      void act(
                        {
                          type: 'install',
                          source_url_or_path: selected.sourceUrl,
                          plugin_relative_path: selected.relativePath,
                        },
                        '已开始安装',
                      )
                    }}
                  >
                    {confirmKey === pluginKey(selected)
                      ? '再点确认：写入本机并加载'
                      : '安装'}
                  </button>
                ) : null}
                {selected.installStatus === 'update_available' ? (
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        {
                          type: 'update',
                          source_url_or_path: selected.sourceUrl,
                          plugin_relative_path: selected.relativePath,
                        },
                        '正在更新',
                      )
                    }
                  >
                    更新
                  </button>
                ) : null}
                {selected.installStatus !== 'not_installed' ? (
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      const key = `rm:${pluginKey(selected)}`
                      if (confirmKey !== key) {
                        setConfirmKey(key)
                        return
                      }
                      void act(
                        {
                          type: 'uninstall',
                          source_url_or_path: selected.sourceUrl,
                          plugin_relative_path: selected.relativePath,
                        },
                        '已卸载',
                      )
                    }}
                  >
                    {confirmKey === `rm:${pluginKey(selected)}`
                      ? '再点确认：从本机卸掉'
                      : '卸载'}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="work-empty">选左侧插件查看来源和操作。</p>
          )}
        </div>
      </div>
    </div>
  )
}
