/**
 * MCP 管理面板 — 官方 list / toggle / toggle_tool / upsert / delete / auth_trigger / setup
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { $mcpPush, pushToast } from '../store'
import { codingSessionReady, useCodingSessionTabId } from '../lib/codingSession'
import {
  deleteMcpServer,
  listCatalogMcp,
  listMcpServers,
  mcpAuthTrigger,
  mcpSetup,
  toggleMcpServer,
  toggleMcpTool,
  upsertMcpServer,
  type McpSetupDto,
  type McpSetupFieldDto,
} from '../bridge'
import { zhServerLabel, zhToolLabel } from '../lib/toolChinese'
import {
  applyMcpStatusPush,
  applyMcpToolsPush,
  formatEnvBlock,
  groupMcpRows,
  joinArgs,
  MCP_GROUP_LABEL,
  normalizeMcpServer,
  parseEnvBlock,
  setupFields,
  splitArgs,
  statusLabel,
  validServerName,
  type McpRow,
} from '../lib/mcpRows'

type TransportKind = 'stdio' | 'http'

const EMPTY_FORM = {
  name: '',
  transport: 'stdio' as TransportKind,
  command: 'npx',
  args: '-y @modelcontextprotocol/server-filesystem .',
  url: '',
  header: '',
  env: '',
}

export function McpPanel() {
  const tabId = useCodingSessionTabId()
  const ready = codingSessionReady(tabId)
  const mcpPush = useStore($mcpPush)
  const [rows, setRows] = useState<McpRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showForm, setShowForm] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [setupName, setSetupName] = useState('')
  const [setupFieldsState, setSetupFieldsState] = useState<McpSetupFieldDto[]>([])
  const [setupValues, setSetupValues] = useState<Record<string, string>>({})
  const [setupError, setSetupError] = useState('')
  const [setupSaving, setSetupSaving] = useState(false)
  const reloadTimer = useRef<number>(0)

  const load = useCallback(
    async (force = false) => {
      setLoading(true)
      setError('')
      try {
        const cat = await listCatalogMcp()
        const fromDisk = (Array.isArray(cat?.servers) ? cat.servers : []).map(normalizeMcpServer)
        const byName = new Map(fromDisk.map((r) => [r.name, r]))
        if (tabId && ready) {
          try {
            const resp = await listMcpServers(tabId, !force)
            const live = (Array.isArray(resp?.servers) ? resp.servers : []).map(normalizeMcpServer)
            for (const r of live) byName.set(r.name, r)
          } catch {
            /* 无会话时只用 config.toml */
          }
        }
        setRows([...byName.values()])
      } catch (e) {
        setError(String(e))
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [tabId, ready],
  )

  useEffect(() => {
    void load(false)
  }, [tabId, load])

  useEffect(() => {
    if (!mcpPush || !tabId) return
    const method = mcpPush.method
    if (method.endsWith('/server_status')) {
      setRows((cur) => applyMcpStatusPush(cur, mcpPush.payload))
      return
    }
    if (method.endsWith('/tools_changed')) {
      setRows((cur) => applyMcpToolsPush(cur, mcpPush.payload))
      const tools = mcpPush.payload.tools
      if (Array.isArray(tools) && tools.length > 0) return
    }
    window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => {
      void load(true)
    }, 160)
    return () => window.clearTimeout(reloadTimer.current)
  }, [mcpPush, tabId, load])

  const openAdd = () => {
    setEditingName(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
    setSetupName('')
  }

  const openEdit = (row: McpRow) => {
    setEditingName(row.name)
    setForm({
      name: row.name,
      transport: row.transport === 'http' || row.transport === 'sse' ? 'http' : 'stdio',
      command: row.command || 'npx',
      args: joinArgs(row.args),
      url: row.url,
      header: '',
      env: formatEnvBlock(row.env),
    })
    setFormError('')
    setShowForm(true)
    setSetupName('')
  }

  const onToggle = async (row: McpRow) => {
    if (!tabId || busyName) return
    setBusyName(row.name)
    try {
      await toggleMcpServer(tabId, row.name, !row.enabled)
      pushToast(row.enabled ? `已停用 ${row.displayName}` : `已启用 ${row.displayName}`, 'success')
      await load(true)
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyName(null)
    }
  }

  const onToggleTool = async (row: McpRow, toolName: string, enabled: boolean) => {
    if (!tabId || busyName) return
    setBusyName(`${row.name}:${toolName}`)
    setRows((cur) =>
      cur.map((r) =>
        r.name !== row.name
          ? r
          : {
              ...r,
              tools: r.tools.map((t) => (t.name === toolName ? { ...t, enabled } : t)),
            },
      ),
    )
    try {
      await toggleMcpTool(tabId, row.name, toolName, enabled)
    } catch (e) {
      pushToast(String(e), 'error')
      await load(true)
    } finally {
      setBusyName(null)
    }
  }

  const onDelete = async (row: McpRow) => {
    if (!tabId || !row.canDelete || busyName) return
    if (!window.confirm(`确定删除「${row.displayName}」？只删本地配置里的这一条。`)) return
    setBusyName(row.name)
    try {
      await deleteMcpServer(tabId, row.name)
      pushToast(`已删除 ${row.displayName}`, 'success')
      await load(true)
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyName(null)
    }
  }

  const openSetup = (row: McpRow, extra?: McpSetupDto | null) => {
    const fields = setupFields(extra ?? row.setup)
    if (fields.length === 0) {
      pushToast('这条服务器没有可填的配置项，可点刷新看看状态', 'error')
      return
    }
    const values: Record<string, string> = {}
    for (const f of fields) {
      values[f.id] = f.default || f.options?.[0]?.value || ''
    }
    setSetupName(row.name)
    setSetupFieldsState(fields)
    setSetupValues(values)
    setSetupError('')
    setShowForm(false)
  }

  const onLogin = async (row: McpRow) => {
    if (!tabId || busyName) return
    setBusyName(row.name)
    try {
      const resp = await mcpAuthTrigger(tabId, row.name)
      const status = String(resp?.status || '')
      if (status === 'authenticated') {
        pushToast(`已登录 ${row.displayName}`, 'success')
        await load(true)
        return
      }
      if (status === 'setup_required') {
        openSetup(row, resp?.setup)
        if (resp?.error) setSetupError(String(resp.error))
        return
      }
      pushToast(resp?.error || `登录未完成（${status || '未知'}）`, 'error')
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyName(null)
    }
  }

  const onSubmitSetup = async () => {
    if (!tabId || !setupName || setupSaving) return
    setSetupSaving(true)
    setSetupError('')
    try {
      const resp = await mcpSetup(tabId, setupName, setupValues)
      if (resp?.ok === false) {
        setSetupError('配置未通过')
        return
      }
      pushToast(`已保存 ${setupName} 的配置`, 'success')
      setSetupName('')
      await load(true)
    } catch (e) {
      setSetupError(String(e))
    } finally {
      setSetupSaving(false)
    }
  }

  const onSubmitForm = async () => {
    if (!tabId || formSaving) return
    const name = (editingName || form.name).trim()
    setFormError('')
    if (!validServerName(name)) {
      setFormError('名称需以字母开头，仅含字母数字 _ -（最长 64）')
      return
    }
    let config: Record<string, unknown>
    if (form.transport === 'stdio') {
      const command = form.command.trim()
      if (!command) {
        setFormError('请填写启动命令，例如 npx 或 uvx')
        return
      }
      const env = parseEnvBlock(form.env)
      config = {
        command,
        args: splitArgs(form.args),
        enabled: true,
      }
      if (Object.keys(env).length) config.env = env
    } else {
      const url = form.url.trim()
      if (!url || !/^https?:\/\//i.test(url)) {
        setFormError('请填写合法的 http(s) URL')
        return
      }
      config = { url, type: 'http', enabled: true }
      const header = form.header.trim()
      if (header) {
        if (/^authorization\s*:/i.test(header)) {
          const v = header.replace(/^authorization\s*:\s*/i, '').trim()
          config.headers = { Authorization: v }
        } else {
          config.headers = {
            Authorization: header.startsWith('Bearer ') ? header : `Bearer ${header}`,
          }
        }
      }
    }
    setFormSaving(true)
    try {
      await upsertMcpServer(tabId, name, config)
      pushToast(editingName ? `已更新 ${name}` : `已添加 ${name}`, 'success')
      setShowForm(false)
      setEditingName(null)
      setForm(EMPTY_FORM)
      await load(true)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setFormSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q) ||
        r.tools.some((t) => t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)),
    )
  }, [rows, query])

  const grouped = useMemo(() => groupMcpRows(filtered), [filtered])
  const stats = useMemo(() => {
    const on = rows.filter((r) => r.enabled).length
    const auth = rows.filter((r) => r.authRequired).length
    return { total: rows.length, on, auth }
  }, [rows])

  const patchForm = (p: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...p }))

  return (
    <div className="mcp-panel" role="region" aria-label="MCP 服务器">
      <div className="mcp-panel-inner">
        <header className="mcp-panel-head">
          <div className="mcp-panel-titles">
            <h2 className="mcp-panel-title">MCP 服务器</h2>
            <p className="mcp-panel-desc">
              外接工具来源。模型会按需搜索并调用；需要对方网站授权的，点「登录」。
              托管连接器在平台管理，这里只能开关。
            </p>
          </div>
          <div className="mcp-panel-actions">
            <span className="mcp-panel-stats">
              {stats.total} 台 · 启用 {stats.on}
              {stats.auth > 0 ? ` · ${stats.auth} 需登录` : ''}
            </span>
            <button
              type="button"
              className="mcp-btn primary"
              disabled={!ready || !tabId}
              onClick={() => (showForm && !editingName ? setShowForm(false) : openAdd())}
            >
              {showForm && !editingName ? '收起' : '添加'}
            </button>
            <button
              type="button"
              className="mcp-btn"
              disabled={loading || !ready || !tabId}
              onClick={() => void load(true)}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </header>

        <div className="mcp-toolbar">
          <input
            className="mcp-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称 / 工具…"
          />
        </div>

        {showForm ? (
          <section className="mcp-form" aria-label={editingName ? '编辑 MCP 服务器' : '添加 MCP 服务器'}>
            <h3 className="mcp-form-title">{editingName ? `编辑 ${editingName}` : '添加 MCP 服务器'}</h3>
            <div className="mcp-form-grid">
              <label className="mcp-field">
                <span>名称</span>
                <input
                  className="mcp-input"
                  value={form.name}
                  disabled={Boolean(editingName)}
                  onChange={(e) => patchForm({ name: e.target.value })}
                  placeholder="例如 filesystem"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="mcp-field">
                <span>传输</span>
                <select
                  className="mcp-input"
                  value={form.transport}
                  onChange={(e) => patchForm({ transport: e.target.value as TransportKind })}
                >
                  <option value="stdio">本地进程</option>
                  <option value="http">远程 HTTP</option>
                </select>
              </label>
              {form.transport === 'stdio' ? (
                <>
                  <label className="mcp-field">
                    <span>命令</span>
                    <input
                      className="mcp-input"
                      value={form.command}
                      onChange={(e) => patchForm({ command: e.target.value })}
                      placeholder="npx / uvx / 绝对路径"
                      spellCheck={false}
                    />
                  </label>
                  <label className="mcp-field mcp-field-span">
                    <span>参数</span>
                    <input
                      className="mcp-input"
                      value={form.args}
                      onChange={(e) => patchForm({ args: e.target.value })}
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
                      spellCheck={false}
                    />
                  </label>
                  <label className="mcp-field mcp-field-span">
                    <span>环境变量（每行 KEY=VALUE）</span>
                    <textarea
                      className="mcp-input mcp-textarea"
                      value={form.env}
                      onChange={(e) => patchForm({ env: e.target.value })}
                      placeholder="GITHUB_TOKEN=ghp_…"
                      rows={3}
                      spellCheck={false}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="mcp-field mcp-field-span">
                    <span>URL</span>
                    <input
                      className="mcp-input"
                      value={form.url}
                      onChange={(e) => patchForm({ url: e.target.value })}
                      placeholder="https://mcp.example.com/mcp"
                      spellCheck={false}
                    />
                  </label>
                  <label className="mcp-field mcp-field-span">
                    <span>Authorization（可选，对方要登录时优先用「登录」按钮）</span>
                    <input
                      className="mcp-input"
                      value={form.header}
                      onChange={(e) => patchForm({ header: e.target.value })}
                      placeholder="Bearer …"
                      spellCheck={false}
                    />
                  </label>
                </>
              )}
            </div>
            {formError ? (
              <div className="mcp-form-error" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="mcp-form-actions">
              <button
                type="button"
                className="mcp-btn"
                disabled={formSaving}
                onClick={() => {
                  setShowForm(false)
                  setEditingName(null)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="mcp-btn primary"
                disabled={formSaving || !ready}
                onClick={() => void onSubmitForm()}
              >
                {formSaving ? '保存中…' : editingName ? '保存' : '保存并启用'}
              </button>
            </div>
          </section>
        ) : null}

        {setupName ? (
          <section className="mcp-form" aria-label="补全 MCP 配置">
            <h3 className="mcp-form-title">补全 {setupName} 的配置</h3>
            <div className="mcp-form-grid">
              {setupFieldsState.map((f) => (
                <label key={f.id} className="mcp-field mcp-field-span">
                  <span>
                    {f.label || f.id}
                    {f.required ? ' *' : ''}
                  </span>
                  {f.options && f.options.length > 0 ? (
                    <select
                      className="mcp-input"
                      value={setupValues[f.id] || ''}
                      onChange={(e) =>
                        setSetupValues((v) => ({ ...v, [f.id]: e.target.value }))
                      }
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label || o.value}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="mcp-input"
                      value={setupValues[f.id] || ''}
                      onChange={(e) =>
                        setSetupValues((v) => ({ ...v, [f.id]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            {setupError ? (
              <div className="mcp-form-error" role="alert">
                {setupError}
              </div>
            ) : null}
            <div className="mcp-form-actions">
              <button type="button" className="mcp-btn" onClick={() => setSetupName('')}>
                取消
              </button>
              <button
                type="button"
                className="mcp-btn primary"
                disabled={setupSaving || !ready}
                onClick={() => void onSubmitSetup()}
              >
                {setupSaving ? '提交中…' : '提交配置'}
              </button>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className="mcp-panel-error" role="alert">
            {error}
            <button type="button" className="mcp-btn" onClick={() => void load(true)}>
              重试
            </button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="mcp-panel-empty">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="mcp-panel-empty">
            <p>还没有 MCP 服务器。</p>
            <p className="mcp-panel-hint">点「添加」接本地进程或远程地址；也可写在 config 的 mcp_servers 里。</p>
            <button type="button" className="mcp-btn primary" style={{ marginTop: '0.75rem' }} onClick={openAdd}>
              添加
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mcp-panel-empty">没有匹配的服务器。</div>
        ) : (
          <div className="mcp-groups">
            {grouped.map(({ group, items }) => (
              <section key={group} className="mcp-group">
                <h3 className="mcp-group-title">
                  {MCP_GROUP_LABEL[group]}
                  <span className="mcp-group-count">{items.length}</span>
                </h3>
                <ul className="mcp-list">
                  {items.map((row) => {
                    const open = Boolean(expanded[row.name])
                    const statusKey = row.status.toLowerCase().replace(/_/g, '')
                    return (
                      <li
                        key={row.name}
                        className={`mcp-card${row.enabled ? ' is-on' : ' is-off'}${row.authRequired ? ' needs-auth' : ''}`}
                      >
                        <div className="mcp-card-main">
                          <button
                            type="button"
                            className="mcp-card-expand"
                            aria-expanded={open}
                            onClick={() =>
                              setExpanded((m) => ({ ...m, [row.name]: !m[row.name] }))
                            }
                          >
                            <span className="mcp-card-name-row">
                              <span className={`mcp-dot status-${statusKey}`} aria-hidden />
                              <span className="mcp-card-name">{row.displayName}</span>
                              {zhServerLabel(row.name) ? (
                                <span className="zh-label">{zhServerLabel(row.name)}</span>
                              ) : null}
                            </span>
                            <span className="mcp-card-meta">
                              <span className={`mcp-pill transport-${row.transport}`}>
                                {row.transport === 'stdio'
                                  ? '本地进程'
                                  : row.transport === 'managed'
                                    ? '托管'
                                    : row.transport.toUpperCase()}
                              </span>
                              <span className={`mcp-pill status-${statusKey}`}>
                                {statusLabel(row.status)}
                              </span>
                              {row.authRequired ? (
                                <span className="mcp-pill warn">需登录</span>
                              ) : null}
                              {row.setupRequired ? (
                                <span className="mcp-pill warn">需配置</span>
                              ) : null}
                              {row.tools.length > 0 ? (
                                <span className="mcp-pill">
                                  {row.tools.filter((t) => t.enabled).length}/{row.tools.length} 工具
                                </span>
                              ) : null}
                            </span>
                            {row.detail ? (
                              <span className="mcp-card-detail" title={row.detail}>
                                {row.detail}
                              </span>
                            ) : null}
                            {row.statusDetail ? (
                              <span className="mcp-card-detail" title={row.statusDetail}>
                                {row.statusDetail}
                              </span>
                            ) : null}
                          </button>
                          <div className="mcp-card-ops">
                            {row.authRequired ? (
                              <button
                                type="button"
                                className="mcp-btn primary"
                                disabled={busyName === row.name || !ready}
                                onClick={() => void onLogin(row)}
                                title="打开浏览器，向这台服务器背后的服务授权"
                              >
                                {busyName === row.name ? '登录中…' : '登录'}
                              </button>
                            ) : null}
                            {row.setupRequired ? (
                              <button
                                type="button"
                                className="mcp-btn"
                                disabled={busyName === row.name || !ready}
                                onClick={() => openSetup(row)}
                              >
                                配置
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={`mcp-toggle${row.enabled ? ' is-on' : ''}`}
                              disabled={busyName === row.name || !ready}
                              onClick={() => void onToggle(row)}
                              aria-pressed={row.enabled}
                            >
                              {busyName === row.name ? '…' : row.enabled ? '已启用' : '已停用'}
                            </button>
                            {row.canEdit ? (
                              <button
                                type="button"
                                className="mcp-btn ghost"
                                disabled={busyName === row.name || !ready}
                                onClick={() => openEdit(row)}
                              >
                                编辑
                              </button>
                            ) : null}
                            {row.canDelete ? (
                              <button
                                type="button"
                                className="mcp-btn danger"
                                disabled={busyName === row.name || !ready}
                                onClick={() => void onDelete(row)}
                              >
                                删除
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {open && row.tools.length > 0 ? (
                          <ul className="mcp-tools">
                            {row.tools.map((t) => (
                              <li
                                key={t.name}
                                className={`mcp-tool${t.enabled ? '' : ' is-off'}`}
                              >
                                <div className="mcp-tool-main">
                                  <span className="mcp-tool-name">{t.label}</span>
                                  {zhToolLabel(t.name) ? (
                                    <span className="zh-label">{zhToolLabel(t.name)}</span>
                                  ) : null}
                                  {t.description ? (
                                    <span className="mcp-tool-desc">{t.description}</span>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className={`mcp-toggle compact${t.enabled ? ' is-on' : ''}`}
                                  disabled={busyName === `${row.name}:${t.name}` || !ready}
                                  onClick={() => void onToggleTool(row, t.name, !t.enabled)}
                                >
                                  {t.enabled ? '开' : '关'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : open ? (
                          <div className="mcp-tools-empty">
                            {row.authRequired
                              ? '登录后才会列出工具。'
                              : row.enabled
                                ? '还没有工具列表（可能仍在连接）。'
                                : '已停用。'}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
