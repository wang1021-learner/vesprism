import { useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { hooksAction, hooksList, listConfigHooks, setConfigHooks, type HookGroup, type HookHandler } from '../bridge'
import { $activeTabId, $sessionPhase, pushToast } from '../store'
import { SettingsLabel } from './SettingsHelp'

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'StopCancelled',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
]

function emptyHandler(): HookHandler {
  return { handler_type: 'command', command: '', url: '', timeout: null }
}

function emptyGroup(): HookGroup {
  return { event: 'PreToolUse', matcher: '', hooks: [emptyHandler()] }
}

export function HooksSettings({
  saving: _saving,
  setSaving,
  onToast,
  bindSave,
}: {
  saving: boolean
  setSaving: (v: boolean) => void
  onToast: (message: string, type: 'success' | 'error') => void
  bindSave?: (fn: (() => Promise<void>) | null) => void
}) {
  const [groups, setGroups] = useState<HookGroup[]>([])

  useEffect(() => {
    void listConfigHooks()
      .then(setGroups)
      .catch((e) => onToast(String(e), 'error'))
    // 只在打开时拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchGroup = (idx: number, next: HookGroup) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? next : g)))
  }

  const patchHandler = (gi: number, hi: number, next: HookHandler) => {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi
          ? { ...g, hooks: g.hooks.map((h, j) => (j === hi ? next : h)) }
          : g,
      ),
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await setConfigHooks(groups)
      setGroups(saved)
      onToast('Hooks 已写入 config.toml', 'success')
    } catch (e) {
      onToast(String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    bindSave?.(() => saveRef.current())
    return () => bindSave?.(null)
  }, [bindSave])

  return (
    <div className="settings-panel-inner">
      <LiveHooksCard />
      <section className="settings-card">
        <h3 className="settings-card-title">官方 Hooks</h3>
        <p className="settings-card-desc">
          写入 <code>[[hooks.&lt;Event&gt;]]</code>。PreToolUse 脚本向 stdout 打印 JSON，可用{' '}
          <code>updatedInput</code> 改写工具入参，而不只是允许/拒绝。
        </p>
        <pre className="settings-hint" style={{ whiteSpace: 'pre-wrap' }}>
          {`{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"npm test"}}}`}
        </pre>
      </section>

      {groups.map((g, gi) => (
        <section className="settings-card" key={`${g.event}-${gi}`}>
          <div className="settings-row">
            <div className="settings-field" style={{ flex: 1, margin: 0 }}>
              <SettingsLabel help="这条钩子挂在哪一步：动手前、动手后、用户提交、停止、子代理结束、会话开始/结束。">
                事件
              </SettingsLabel>
              <select
                className="settings-input"
                value={g.event}
                onChange={(e) => patchGroup(gi, { ...g, event: e.target.value })}
              >
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setGroups((prev) => prev.filter((_, i) => i !== gi))}
            >
              删除组
            </button>
          </div>
          <SettingsLabel help="按工具名过滤，支持正则。空=所有工具。例如 Bash|Write，或 run_terminal_command。">
            matcher（工具名正则，空=全部）
          </SettingsLabel>
          <input
            className="settings-input"
            value={g.matcher}
            onChange={(e) => patchGroup(gi, { ...g, matcher: e.target.value })}
            placeholder="Bash|Write|Edit 或 run_terminal_command"
          />
          {g.hooks.map((h, hi) => (
            <div key={hi} className="settings-hook-handler">
              <div className="settings-row">
                <select
                  className="settings-input"
                  value={h.handler_type}
                  onChange={(e) =>
                    patchHandler(gi, hi, { ...h, handler_type: e.target.value })
                  }
                >
                  <option value="command">command</option>
                  <option value="http">http</option>
                </select>
                <input
                  className="settings-input"
                  type="number"
                  min={1}
                  placeholder="timeout 秒"
                  value={h.timeout ?? ''}
                  onChange={(e) =>
                    patchHandler(gi, hi, {
                      ...h,
                      timeout: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  style={{ maxWidth: 120 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    patchGroup(gi, { ...g, hooks: g.hooks.filter((_, j) => j !== hi) })
                  }
                >
                  删除
                </button>
              </div>
              {h.handler_type === 'http' ? (
                <input
                  className="settings-input"
                  value={h.url}
                  onChange={(e) => patchHandler(gi, hi, { ...h, url: e.target.value })}
                  placeholder="https://…"
                />
              ) : (
                <input
                  className="settings-input"
                  value={h.command}
                  onChange={(e) => patchHandler(gi, hi, { ...h, command: e.target.value })}
                  placeholder="/opt/guard/pretooluse.sh"
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => patchGroup(gi, { ...g, hooks: [...g.hooks, emptyHandler()] })}
          >
            添加 handler
          </button>
        </section>
      ))}

      <div className="settings-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setGroups((prev) => [...prev, emptyGroup()])}
        >
          + 添加 PreToolUse 组
        </button>
      </div>
    </div>
  )
}

type LiveHook = {
  name: string
  event: string
  disabled: boolean
  projectTrusted: boolean
}

function LiveHooksCard() {
  const tabId = useStore($activeTabId)
  const ready = useStore($sessionPhase) === 'ready'
  const [hooks, setHooks] = useState<LiveHook[]>([])
  const [trusted, setTrusted] = useState(false)
  const [busy, setBusy] = useState('')

  const load = async () => {
    if (!tabId || !ready) return
    try {
      const raw = await hooksList(tabId)
      const list = Array.isArray(raw.hooks) ? raw.hooks : []
      setTrusted(Boolean(raw.projectTrusted ?? raw.project_trusted))
      setHooks(
        list.map((h) => {
          const o = (h || {}) as Record<string, unknown>
          return {
            name: String(o.name || o.hookName || ''),
            event: String(o.event || ''),
            disabled: Boolean(o.disabled),
            projectTrusted: Boolean(raw.projectTrusted ?? raw.project_trusted),
          }
        }),
      )
    } catch {
      setHooks([])
    }
  }

  useEffect(() => {
    void load()
  }, [tabId, ready])

  const act = async (action: Record<string, unknown>, ok: string) => {
    if (!tabId || busy) return
    setBusy('1')
    try {
      const r = await hooksAction(tabId, action)
      pushToast(typeof r?.message === 'string' ? r.message : ok, 'success')
      await load()
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  if (!ready) return null
  return (
    <section className="settings-card">
      <h3 className="settings-card-title">本会话已加载</h3>
      <p className="settings-card-desc">
        项目 Hooks {trusted ? '已信任' : '未信任'}。下面按条开关，不改配置文件。
      </p>
      <div className="work-panel-actions" style={{ marginBottom: 8 }}>
        <button
          type="button"
          className="skills-btn"
          disabled={Boolean(busy)}
          onClick={() => void act({ type: trusted ? 'untrust' : 'trust' }, trusted ? '已取消信任' : '已信任')}
        >
          {trusted ? '取消信任项目' : '信任项目'}
        </button>
        <button
          type="button"
          className="skills-btn"
          disabled={Boolean(busy)}
          onClick={() => void act({ type: 'reload' }, '已重载')}
        >
          重载
        </button>
      </div>
      {hooks.length === 0 ? (
        <p className="settings-hint">当前会话没有加载中的 hook。</p>
      ) : (
        hooks.map((h) => (
          <div key={h.name} className="settings-row" style={{ marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 13 }}>
              {h.name}
              <span className="settings-hint"> · {h.event}</span>
            </span>
            <button
              type="button"
              className="skills-btn"
              disabled={Boolean(busy) || !h.name}
              onClick={() =>
                void act(
                  { type: h.disabled ? 'enable' : 'disable', hookName: h.name },
                  h.disabled ? '已启用' : '已停用',
                )
              }
            >
              {h.disabled ? '启用' : '停用'}
            </button>
          </div>
        ))
      )}
    </section>
  )
}
