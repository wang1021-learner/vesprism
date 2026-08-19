import { useEffect, useRef, useState } from 'react'
import { listConfigHooks, setConfigHooks, type HookGroup, type HookHandler } from '../bridge'

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
            <label className="settings-label">
              事件
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
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setGroups((prev) => prev.filter((_, i) => i !== gi))}
            >
              删除组
            </button>
          </div>
          <label className="settings-label">
            matcher（工具名正则，空=全部）
            <input
              className="settings-input"
              value={g.matcher}
              onChange={(e) => patchGroup(gi, { ...g, matcher: e.target.value })}
              placeholder="Bash|Write|Edit 或 run_terminal_command"
            />
          </label>
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
