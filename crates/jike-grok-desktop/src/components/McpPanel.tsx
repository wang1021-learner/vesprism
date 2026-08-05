/**
 * MCP 管理面板 — 官方 x.ai/mcp/list | toggle | upsert | delete
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { $activeTabId, $shellReady, pushToast } from '../store'
import {
  deleteMcpServer,
  listMcpServers,
  toggleMcpServer,
  upsertMcpServer,
  type McpServerDto,
} from '../bridge'

type Row = {
  name: string
  displayName: string
  source: string
  sourceLabel: string
  transport: string
  detail: string
  enabled: boolean
  status: string
  tools: Array<{ name: string; label: string; description: string; enabled: boolean }>
  authRequired: boolean
  setupRequired: boolean
  /** managed 不可删 */
  canDelete: boolean
}

type TransportKind = 'stdio' | 'http'

function normalize(s: McpServerDto): Row {
  const session = s.session
  const displayName =
    (s.displayName || s.display_name || s.name || '').trim() || s.name
  const type = (s.type || '').toLowerCase()
  let transport = type || 'unknown'
  let detail = ''
  if (type === 'http' || s.url) {
    transport = 'http'
    detail = s.url || ''
  } else if (type === 'stdio' || s.command) {
    transport = 'stdio'
    const cmd = s.command || ''
    const args = Array.isArray(s.args) ? s.args.join(' ') : ''
    detail = [cmd, args].filter(Boolean).join(' ')
  } else if (type === 'managedgateway') {
    // 官方 serde `managedGateway` 经 toLowerCase() 后为 managedgateway
    transport = 'managed'
    detail = 'Managed gateway'
  }
  const source = String(s.source || 'local').toLowerCase()
  const tools = (session?.tools || []).map((t) => ({
    name: t.name,
    label: (t.displayName || t.display_name || t.name || '').trim() || t.name,
    description: (t.description || '').trim(),
    enabled: t.enabled !== false,
  }))
  return {
    name: s.name,
    displayName,
    source,
    sourceLabel: (s.sourceLabel || s.source_label || s.source || '').toString(),
    transport,
    detail,
    enabled: session?.enabled !== false,
    status: (session?.status || (session ? 'ready' : '—')).toString(),
    tools,
    authRequired: Boolean(session?.authRequired ?? session?.auth_required),
    setupRequired: Boolean(session?.setupRequired ?? session?.setup_required),
    canDelete: source !== 'managed' && transport !== 'managed',
  }
}

function statusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'ready':
      return '就绪'
    case 'initializing':
      return '初始化'
    case 'setuprequired':
    case 'setup_required':
      return '需配置'
    case 'unavailable':
      return '不可用'
    default:
      return status || '—'
  }
}

/** 名称：字母数字 _ - */
function validServerName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)
}

/** 简易 shell 分词：引号包裹或空白分隔 */
function splitArgs(raw: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out.filter(Boolean)
}

export function McpPanel() {
  const tabId = useStore($activeTabId)
  const ready = useStore($shellReady)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showForm, setShowForm] = useState(false)

  // 添加表单
  const [formName, setFormName] = useState('')
  const [formTransport, setFormTransport] = useState<TransportKind>('stdio')
  const [formCommand, setFormCommand] = useState('npx')
  const [formArgs, setFormArgs] = useState(
    '-y @modelcontextprotocol/server-filesystem .',
  )
  const [formUrl, setFormUrl] = useState('')
  const [formHeader, setFormHeader] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(
    async (force = false) => {
      if (!tabId) return
      setLoading(true)
      setError('')
      try {
        const resp = await listMcpServers(tabId, !force)
        const list = Array.isArray(resp?.servers) ? resp.servers : []
        setRows(list.map(normalize))
      } catch (e) {
        setError(String(e))
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [tabId],
  )

  useEffect(() => {
    if (!tabId) return
    void load(false)
  }, [tabId, load])

  const onToggle = useCallback(
    async (row: Row) => {
      if (!tabId || busyName) return
      setBusyName(row.name)
      try {
        await toggleMcpServer(tabId, row.name, !row.enabled)
        pushToast(
          row.enabled ? `已禁用 ${row.displayName}` : `已启用 ${row.displayName}`,
          'success',
        )
        await load(true)
      } catch (e) {
        pushToast(`切换失败 · ${String(e)}`, 'error')
      } finally {
        setBusyName(null)
      }
    },
    [tabId, busyName, load],
  )

  const onDelete = useCallback(
    async (row: Row) => {
      if (!tabId || !row.canDelete || busyName) return
      if (!window.confirm(`确定删除 MCP 服务器「${row.displayName}」？\n仅可删除本地 config 中的条目。`)) {
        return
      }
      setBusyName(row.name)
      try {
        await deleteMcpServer(tabId, row.name)
        pushToast(`已删除 ${row.displayName}`, 'success')
        await load(true)
      } catch (e) {
        pushToast(`删除失败 · ${String(e)}`, 'error')
      } finally {
        setBusyName(null)
      }
    },
    [tabId, busyName, load],
  )

  const onSubmitAdd = useCallback(async () => {
    if (!tabId || formSaving) return
    const name = formName.trim()
    setFormError('')
    if (!validServerName(name)) {
      setFormError('名称需以字母开头，仅含字母数字 _ -（最长 64）')
      return
    }
    let config: Record<string, unknown>
    if (formTransport === 'stdio') {
      const command = formCommand.trim()
      if (!command) {
        setFormError('请填写启动命令，例如 npx 或 uvx')
        return
      }
      config = {
        command,
        args: splitArgs(formArgs),
        enabled: true,
      }
    } else {
      const url = formUrl.trim()
      if (!url || !/^https?:\/\//i.test(url)) {
        setFormError('请填写合法的 http(s) URL')
        return
      }
      config = {
        url,
        type: 'http',
        enabled: true,
      }
      const header = formHeader.trim()
      if (header) {
        // Authorization: Bearer xxx 或直接 token
        if (/^authorization\s*:/i.test(header)) {
          const v = header.replace(/^authorization\s*:\s*/i, '').trim()
          config.headers = { Authorization: v }
        } else {
          config.headers = { Authorization: header.startsWith('Bearer ') ? header : `Bearer ${header}` }
        }
      }
    }
    setFormSaving(true)
    try {
      await upsertMcpServer(tabId, name, config)
      pushToast(`已添加 MCP · ${name}`, 'success')
      setShowForm(false)
      setFormName('')
      setFormUrl('')
      setFormHeader('')
      await load(true)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setFormSaving(false)
    }
  }, [
    tabId,
    formSaving,
    formName,
    formTransport,
    formCommand,
    formArgs,
    formUrl,
    formHeader,
    load,
  ])

  const stats = useMemo(() => {
    const on = rows.filter((r) => r.enabled).length
    return { total: rows.length, on }
  }, [rows])

  return (
    <div className="mcp-panel" role="region" aria-label="MCP 服务器">
      <div className="mcp-panel-inner">
        <header className="mcp-panel-head">
          <div className="mcp-panel-titles">
            <h2 className="mcp-panel-title">MCP 服务器</h2>
            <p className="mcp-panel-desc">
              可视化管理：列表 / 启用禁用 / <strong>添加</strong> / 删除。
              对接官方 <code>x.ai/mcp/*</code>，写入本地 config。
            </p>
          </div>
          <div className="mcp-panel-actions">
            <span className="mcp-panel-stats">
              {stats.total} 台 · 启用 {stats.on}
            </span>
            <button
              type="button"
              className="mcp-btn primary"
              disabled={!ready || !tabId}
              onClick={() => {
                setShowForm((v) => !v)
                setFormError('')
              }}
            >
              {showForm ? '收起表单' : '+ 添加服务器'}
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

        {showForm ? (
          <section className="mcp-form" aria-label="添加 MCP 服务器">
            <h3 className="mcp-form-title">添加 MCP 服务器</h3>
            <div className="mcp-form-grid">
              <label className="mcp-field">
                <span>名称</span>
                <input
                  className="mcp-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如 filesystem"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="mcp-field">
                <span>传输类型</span>
                <select
                  className="mcp-input"
                  value={formTransport}
                  onChange={(e) =>
                    setFormTransport(e.target.value as TransportKind)
                  }
                >
                  <option value="stdio">本地进程 (stdio)</option>
                  <option value="http">远程 HTTP / SSE</option>
                </select>
              </label>
              {formTransport === 'stdio' ? (
                <>
                  <label className="mcp-field">
                    <span>命令</span>
                    <input
                      className="mcp-input"
                      value={formCommand}
                      onChange={(e) => setFormCommand(e.target.value)}
                      placeholder="npx / uvx / 绝对路径"
                      spellCheck={false}
                    />
                  </label>
                  <label className="mcp-field mcp-field-span">
                    <span>参数（空格分隔，可用引号）</span>
                    <input
                      className="mcp-input"
                      value={formArgs}
                      onChange={(e) => setFormArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
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
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      placeholder="https://mcp.example.com/mcp"
                      spellCheck={false}
                    />
                  </label>
                  <label className="mcp-field mcp-field-span">
                    <span>Authorization（可选）</span>
                    <input
                      className="mcp-input"
                      value={formHeader}
                      onChange={(e) => setFormHeader(e.target.value)}
                      placeholder="Bearer sk-… 或完整 Authorization 值"
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
                onClick={() => setShowForm(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="mcp-btn primary"
                disabled={formSaving || !ready}
                onClick={() => void onSubmitAdd()}
              >
                {formSaving ? '保存中…' : '保存并启用'}
              </button>
            </div>
            <p className="mcp-form-hint">
              等价 CLI：
              <code>
                {formTransport === 'stdio'
                  ? `grok mcp add ${formName || 'name'} -- ${formCommand} ${formArgs}`
                  : `grok mcp add --transport http ${formName || 'name'} ${formUrl || '<url>'}`}
              </code>
            </p>
          </section>
        ) : null}

        {error ? (
          <div className="mcp-panel-error" role="alert">
            {error}
            <button
              type="button"
              className="mcp-btn"
              onClick={() => void load(true)}
            >
              重试
            </button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="mcp-panel-empty">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="mcp-panel-empty">
            <p>还没有 MCP 服务器。</p>
            <p className="mcp-panel-hint">
              点击上方 <strong>+ 添加服务器</strong> 用可视化表单添加，或在
              config 中配置 <code>[mcp_servers.*]</code>。
            </p>
            <button
              type="button"
              className="mcp-btn primary"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setShowForm(true)}
            >
              + 添加服务器
            </button>
          </div>
        ) : (
          <ul className="mcp-list">
            {rows.map((row) => {
              const open = Boolean(expanded[row.name])
              return (
                <li
                  key={row.name}
                  className={`mcp-card${row.enabled ? ' is-on' : ' is-off'}`}
                >
                  <div className="mcp-card-main">
                    <button
                      type="button"
                      className="mcp-card-expand"
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((m) => ({ ...m, [row.name]: !m[row.name] }))
                      }
                      title={open ? '收起工具' : '展开工具'}
                    >
                      <span className="mcp-card-name">{row.displayName}</span>
                      <span className="mcp-card-meta">
                        <span className={`mcp-pill transport-${row.transport}`}>
                          {row.transport}
                        </span>
                        <span className="mcp-pill source">
                          {row.sourceLabel || row.source}
                        </span>
                        <span
                          className={`mcp-pill status-${row.status.toLowerCase()}`}
                        >
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
                            {row.tools.length} tools
                          </span>
                        ) : null}
                      </span>
                      {row.detail ? (
                        <span className="mcp-card-detail" title={row.detail}>
                          {row.detail}
                        </span>
                      ) : null}
                    </button>
                    <div className="mcp-card-ops">
                      <button
                        type="button"
                        className={`mcp-toggle${row.enabled ? ' is-on' : ''}`}
                        disabled={busyName === row.name || !ready}
                        onClick={() => void onToggle(row)}
                        aria-pressed={row.enabled}
                      >
                        {busyName === row.name
                          ? '…'
                          : row.enabled
                            ? '已启用'
                            : '已禁用'}
                      </button>
                      {row.canDelete ? (
                        <button
                          type="button"
                          className="mcp-btn danger"
                          disabled={busyName === row.name || !ready}
                          onClick={() => void onDelete(row)}
                          title="从本地配置删除"
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
                          <span className="mcp-tool-name">{t.label}</span>
                          {t.description ? (
                            <span className="mcp-tool-desc">
                              {t.description}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : open ? (
                    <div className="mcp-tools-empty">
                      暂无工具列表（可能未就绪）
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
