/**
 * 自动化任务（工作流）面板 — 官方 x.ai/workflows/list
 * 可浏览 Rhai 工作流；复制 /name 或填入 Composer。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  $activeTabId,
  $sessionPhase,
  $utilityKind,
  $workflows,
  fillComposerOnChatTab,
  pushToast,
} from '../store'
import { sendEngineSlash, openSessionSchedule } from '../lib/engineSlash'
import {
  listRunningSubagents,
  listSessionCommands,
  listWorkflows,
  type RunningSubagentInfo,
} from '../bridge'
import {
  parseWorkflowListings,
  parseWorkflowsFromCommands,
  sourceBucket,
  sourceLabel,
  SOURCE_BUCKET_ORDER,
  type WorkflowRow,
} from '../lib/parseWorkflows'

export function WorkflowsPanel() {
  const tabId = useStore($activeTabId)
  const live = useStore($workflows)
  const ready = useStore($sessionPhase) === 'ready'
  const [rows, setRows] = useState<WorkflowRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string | 'all'>('all')
  const [viaFallback, setViaFallback] = useState(false)
  const [running, setRunning] = useState<RunningSubagentInfo[]>([])

  const load = useCallback(async () => {
    if (!tabId) return
    setLoading(true)
    setError('')
    setViaFallback(false)
    try {
      const resp = await listWorkflows(tabId)
      let list = parseWorkflowListings(
        (Array.isArray(resp?.workflows) ? resp.workflows : []) as Array<
          Record<string, unknown>
        >,
      )
      // 官方在关闭 launches 时返回空数组；回退到 commands/list 中的 workflow 条目
      if (list.length === 0) {
        try {
          const cmds = await listSessionCommands(tabId)
          const fromCmds = parseWorkflowsFromCommands(cmds?.commands)
          if (fromCmds.length > 0) {
            list = fromCmds
            setViaFallback(true)
          }
        } catch {
          /* 回退失败仍展示空列表 */
        }
      }
      setRows(list)
    } catch (e) {
      setError(String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tabId])

  useEffect(() => {
    if (!tabId) return
    void load()
  }, [tabId, load])

  useEffect(() => {
    if (!tabId) return
    let stop = false
    const tick = () => {
      listRunningSubagents(tabId)
        .then((rows) => {
          if (!stop) setRunning(Array.isArray(rows) ? rows : [])
        })
        .catch(() => {
          if (!stop) setRunning([])
        })
    }
    tick()
    const id = window.setInterval(tick, 3000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [tabId])

  const sourcesPresent = useMemo(() => {
    const s = new Set(rows.map((r) => sourceBucket(r.source)))
    return SOURCE_BUCKET_ORDER.filter((x) => s.has(x))
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (sourceFilter !== 'all' && sourceBucket(r.source) !== sourceFilter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.whenToUse.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q)
      )
    })
  }, [rows, query, sourceFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, WorkflowRow[]>()
    for (const r of filtered) {
      const bucket = sourceBucket(r.source)
      const list = map.get(bucket) || []
      list.push(r)
      map.set(bucket, list)
    }
    return [...SOURCE_BUCKET_ORDER, ...map.keys()]
      .filter((k, i, arr) => map.has(k) && arr.indexOf(k) === i)
      .map((source) => ({ source, items: map.get(source)! }))
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

  /** 填入输入框并退出专用面板 */
  const fillInChat = (name: string) => {
    $utilityKind.set(null)
    fillComposerOnChatTab(`/${name} `)
    pushToast(`已填入 /${name}，可补充参数后发送`, 'success')
  }

  return (
    <div className="workflows-panel" role="region" aria-label="自动化任务">
      <div className="workflows-panel-inner">
        <header className="workflows-panel-head">
          <div className="workflows-panel-titles">
            <h2 className="workflows-panel-title">自动化任务</h2>
            <p className="workflows-panel-desc">
              Rhai 工作流：多阶段编排脚本。对话里输入{' '}
              <code>/工作流名</code> 启动，也可直接说流程名——模型看得到已发布列表。
              点「使用」会填进输入框。脚本在 <code>.grok/workflows/*.rhai</code> 或用户配置目录。
            </p>
          </div>
          <div className="workflows-panel-actions">
            <span className="workflows-panel-stats">{rows.length} 个任务</span>
            <button
              type="button"
              className="workflows-btn"
              disabled={loading || !tabId}
              onClick={() => void load()}
            >
              {loading ? '加载中…' : '刷新'}
            </button>
          </div>
        </header>

        {Object.keys(live).length > 0 && (
          <div className="workflows-running" role="status">
            <strong>正在跑</strong>
            <ul>
              {Object.values(live).map((w) => (
                <li key={w.runId} style={{ marginBottom: 6 }}>
                  <div>
                    {w.name || w.runId} · {w.status}
                    {w.currentPhase ? ` · ${w.currentPhase}` : ''}
                    {w.agentBudget
                      ? ` · ${w.agentsUsed}/${w.agentBudget} agent`
                      : w.agentsUsed
                        ? ` · ${w.agentsUsed} agent`
                        : ''}
                  </div>
                  <div className="work-panel-actions" style={{ marginTop: 4 }}>
                    {w.status === 'paused' ? (
                      <button
                        type="button"
                        className="workflows-btn"
                        disabled={!ready}
                        onClick={() =>
                          void sendEngineSlash(`/workflow resume ${w.name}`).then(() =>
                            pushToast('已继续工作流', 'success'),
                          )
                        }
                      >
                        继续
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="workflows-btn"
                        disabled={!ready}
                        onClick={() =>
                          void sendEngineSlash(`/workflow pause ${w.name}`).then(() =>
                            pushToast('已暂停工作流', 'success'),
                          )
                        }
                      >
                        暂停
                      </button>
                    )}
                    <button
                      type="button"
                      className="workflows-btn"
                      disabled={!ready}
                      onClick={() =>
                        void sendEngineSlash(`/workflow stop ${w.name}`).then(() =>
                          pushToast('已停止工作流', 'success'),
                        )
                      }
                    >
                      停止
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="work-panel-desc" style={{ marginBottom: 12 }}>
          按间隔反复跑同一条指令是「定时任务」，挂在当前对话上。
          <button
            type="button"
            className="workflows-btn"
            style={{ marginLeft: 8 }}
            onClick={() => openSessionSchedule()}
          >
            打开定时任务
          </button>
        </div>

        {running.length > 0 && (
          <div className="workflows-running" role="status">
            {running.length} 个子任务正在运行
            <ul>
              {running.slice(0, 4).map((r) => (
                <li key={r.subagentId || r.childSessionId}>
                  {r.description || r.subagentType || '子任务'}
                  {r.durationMs ? ` · ${Math.round(r.durationMs / 1000)}s` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {viaFallback && (
          <div className="workflows-banner">
            已从会话斜杠命令回退列出工作流（workflows/list 为空）
          </div>
        )}

        <div className="workflows-toolbar">
          <input
            className="workflows-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、描述、路径…"
            aria-label="搜索工作流"
          />
        </div>

        {sourcesPresent.length > 0 && (
          <div className="workflows-scope-row" role="tablist" aria-label="来源筛选">
            <button
              type="button"
              className={`workflows-scope-chip${sourceFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setSourceFilter('all')}
            >
              全部
            </button>
            {sourcesPresent.map((s) => (
              <button
                key={s}
                type="button"
                className={`workflows-scope-chip${sourceFilter === s ? ' is-active' : ''}`}
                onClick={() => setSourceFilter(s)}
              >
                {sourceLabel(s)}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="workflows-error">
            <div>{error}</div>
            <button type="button" className="workflows-btn" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}

        {!error && !loading && filtered.length === 0 && (
          <div className="workflows-empty">
            {rows.length === 0 ? (
              <>
                <p>当前工作区未发现自动化任务。</p>
                <p className="workflows-hint">
                  在仓库或用户目录创建 <code>.grok/workflows/名称.rhai</code>，
                  文件名与脚本内 <code>meta.name</code> 一致后点刷新。
                </p>
                <pre className="workflows-code">{`let meta = #{
  name: "demo-task",
  description: "示例自动化任务",
};
// … 编排逻辑 …
complete("done");`}</pre>
              </>
            ) : (
              <p>没有匹配「{query}」的任务</p>
            )}
          </div>
        )}

        {loading && rows.length === 0 && !error && (
          <div className="workflows-empty">加载中…</div>
        )}

        <div className="workflows-groups">
          {grouped.map(({ source, items }) => (
            <section key={source} className="workflows-group">
              <h3 className="workflows-group-title">
                {sourceLabel(source)}
                <span className="workflows-group-count">{items.length}</span>
              </h3>
              <ul className="workflows-list">
                {items.map((wf) => (
                  <li key={`${source}:${wf.name}`} className="workflows-card">
                    <div className="workflows-card-main">
                      <div className="workflows-card-titles">
                        <span className="workflows-card-label">{wf.name}</span>
                        <code className="workflows-card-slash">/{wf.name}</code>
                      </div>
                      <p className="workflows-card-desc">{wf.description}</p>
                      {wf.whenToUse ? (
                        <p className="workflows-card-when">
                          <span className="workflows-card-when-label">适用</span>
                          {wf.whenToUse}
                        </p>
                      ) : null}
                      {wf.path ? (
                        <p className="workflows-card-path" title={wf.path}>
                          {wf.path}
                        </p>
                      ) : null}
                    </div>
                    <div className="workflows-card-actions">
                      <button
                        type="button"
                        className="workflows-btn ghost"
                        onClick={() => void copySlash(wf.name)}
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        className="workflows-btn primary"
                        onClick={() => fillInChat(wf.name)}
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
      </div>
    </div>
  )
}
