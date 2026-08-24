import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import {
  $activeSessionId,
  $activeTabId,
  $compositionOpen,
  $workspaceCwd,
  pushToast,
} from '../store'
import { applyComposition, getComposition, saveComposition } from '../bridge'
import {
  compositionToYaml,
  emptyComposition,
  formatMcpServerLine,
  parseMcpServerLine,
  type CompositionData,
  type PermissionMode,
  type PermissionRule,
  type Policy,
} from '../lib/composition'

type Section = 'model' | 'persona' | 'tools' | 'skills' | 'permissions' | 'mcp' | 'plugins' | 'flows'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'model', label: '模型' },
  { id: 'persona', label: '人设段落' },
  { id: 'tools', label: '工具' },
  { id: 'skills', label: '技能' },
  { id: 'permissions', label: '权限' },
  { id: 'mcp', label: 'MCP' },
  { id: 'plugins', label: '插件目录' },
  { id: 'flows', label: '流程' },
]

function splitList(s: string): string[] {
  return s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 会话组装面板（半插件化 P0 最小组装面板）。 */
export function CompositionPanel() {
  const open = useStore($compositionOpen)
  if (!open) return null
  return <CompositionPanelInner />
}

function CompositionPanelInner() {
  const tabId = useStore($activeTabId)
  const sessionId = useStore($activeSessionId)
  const cwd = useStore($workspaceCwd)
  const [section, setSection] = useState<Section>('tools')
  const [draft, setDraft] = useState<CompositionData>(emptyComposition)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saveName, setSaveName] = useState('')

  const close = useCallback(() => {
    $compositionOpen.set(false)
    setSaveName('')
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getComposition(sessionId || null, cwd || '')
      .then((c) => {
        if (!cancelled) setDraft({ ...emptyComposition(), ...c, flows: c.flows ?? [] })
      })
      .catch((e) => {
        if (!cancelled) pushToast(`读取组装单失败：${String(e)}`, 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, cwd])

  const patch = useCallback((p: Partial<CompositionData>) => {
    setDraft((d) => ({ ...d, ...p }))
  }, [])

  const onApply = useCallback(async () => {
    setBusy(true)
    try {
      await applyComposition(tabId, sessionId || null, {
        ...draft,
        flows: Array.isArray(draft.flows) ? draft.flows : [],
      })
      pushToast('组装单已应用到当前会话', 'success')
      close()
    } catch (e) {
      pushToast(`应用失败：${String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [tabId, sessionId, draft, close])

  const onSave = useCallback(async () => {
    const name = saveName.trim()
    if (!name) {
      pushToast('请填写组装单名称', 'error')
      return
    }
    setBusy(true)
    try {
      await saveComposition(name, compositionToYaml(draft))
      pushToast(`已保存为用户级组装单：${name}`, 'success')
      setSaveName('')
    } catch (e) {
      pushToast(`保存失败：${String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [saveName, draft])

  return (
    <div className="comp-backdrop" role="dialog" aria-modal="true" aria-label="会话组装">
      <div className="comp-modal">
        <header className="comp-head">
          <span className="comp-title">会话组装单</span>
          <span className="comp-subtitle">
            应用到当前会话：模型、人设段落、工具、技能、权限、MCP、插件目录、流程。
          </span>
          <button type="button" className="comp-close" onClick={close} title="关闭">
            ✕
          </button>
        </header>
        <div className="comp-body">
          <nav className="comp-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`comp-nav-item${section === s.id ? ' is-active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="comp-content">
            {loading ? (
              <div className="comp-empty">读取中…</div>
            ) : (
              <SectionBody section={section} draft={draft} patch={patch} />
            )}
          </div>
        </div>
        <footer className="comp-foot">
          <input
            className="comp-save-name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="组装单名（另存为）"
          />
          <button type="button" className="comp-btn" disabled={busy} onClick={() => void onSave()}>
            另存为
          </button>
          <div className="comp-foot-spacer" />
          <button type="button" className="comp-btn-ghost" disabled={busy} onClick={close}>
            取消
          </button>
          <button type="button" className="comp-btn-primary" disabled={busy || loading} onClick={() => void onApply()}>
            {busy ? '应用中…' : '应用'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function SectionBody({
  section,
  draft,
  patch,
}: {
  section: Section
  draft: CompositionData
  patch: (p: Partial<CompositionData>) => void
}) {
  switch (section) {
    case 'model':
      return (
        <>
          <label className="comp-field">
            <span className="comp-label">模型 id（官方 catalog 名）</span>
            <input
              className="comp-input"
              value={draft.model.name ?? ''}
              placeholder="留空则不改当前模型"
              onChange={(e) =>
                patch({
                  model: {
                    ...draft.model,
                    name: e.target.value.trim() || null,
                  },
                })
              }
            />
          </label>
          <label className="comp-field">
            <span className="comp-label">推理强度</span>
            <select
              className="comp-input"
              value={draft.model.reasoning_effort ?? ''}
              onChange={(e) =>
                patch({
                  model: {
                    ...draft.model,
                    reasoning_effort: e.target.value || null,
                  },
                })
              }
            >
              <option value="">不改</option>
              <option value="none">none</option>
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
            </select>
          </label>
          <label className="comp-field">
            <span className="comp-label">人设标签（官方 systemPromptLabel）</span>
            <input
              className="comp-input"
              value={draft.persona.label ?? ''}
              placeholder="随模型走的人设名，可空"
              onChange={(e) =>
                patch({
                  persona: {
                    ...draft.persona,
                    label: e.target.value.trim() || null,
                  },
                })
              }
            />
          </label>
        </>
      )
    case 'persona':
      return (
        <label className="comp-field">
          <span className="comp-label">人设段落（写入系统提示专用规则块，一段一行）</span>
          <textarea
            className="comp-input"
            rows={8}
            value={draft.persona.sections.join('\n')}
            placeholder="例如：回复使用中文。先给方案再动手。"
            onChange={(e) =>
              patch({
                persona: {
                  ...draft.persona,
                  sections: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
      )
    case 'tools':
      return (
        <label className="comp-field">
          <span className="comp-label">停用工具（官方函数名，如 run_terminal_command / web_search）</span>
          <input
            className="comp-input"
            value={draft.tools.disable.join(', ')}
            placeholder="如：run_terminal_command, web_search"
            onChange={(e) => patch({ tools: { ...draft.tools, disable: splitList(e.target.value) } })}
          />
        </label>
      )
    case 'skills':
      return (
        <>
          <label className="comp-field">
            <span className="comp-label">可见作用域（local/repo/user/server/bundled/plugin；空=不限）</span>
            <input
              className="comp-input"
              value={draft.skills.scopes.join(', ')}
              placeholder="如：user, repo"
              onChange={(e) =>
                patch({ skills: { ...draft.skills, scopes: splitList(e.target.value) } })
              }
            />
          </label>
          <label className="comp-field">
            <span className="comp-label">排除技能名（支持 * 通配）</span>
            <input
              className="comp-input"
              value={draft.skills.exclude.join(', ')}
              placeholder="如：web-*"
              onChange={(e) =>
                patch({ skills: { ...draft.skills, exclude: splitList(e.target.value) } })
              }
            />
          </label>
        </>
      )
    case 'permissions':
      return (
        <>
          <label className="comp-field">
            <span className="comp-label">权限模式（官方 yolo/auto，会话级）</span>
            <select
              className="comp-input"
              value={draft.permissions.mode}
              onChange={(e) =>
                patch({ permissions: { ...draft.permissions, mode: e.target.value as PermissionMode } })
              }
            >
              <option value="ask">ask（默认审批流）</option>
              <option value="yolo">yolo（自动放行）</option>
              <option value="auto">auto（LLM 分类器）</option>
            </select>
          </label>
          <div className="comp-label">规则（deny 优先于只读自动放行；如 edit:**/.env → deny）</div>
          <div className="comp-rules">
            {draft.permissions.rules.map((r, i) => (
              <div className="comp-rule" key={i}>
                <input
                  className="comp-input"
                  value={r.match}
                  placeholder="匹配表达式"
                  onChange={(e) => {
                    const rules = draft.permissions.rules.slice()
                    rules[i] = { ...rules[i], match: e.target.value }
                    patch({ permissions: { ...draft.permissions, rules } })
                  }}
                />
                <select
                  className="comp-input comp-rule-policy"
                  value={r.policy}
                  onChange={(e) => {
                    const rules = draft.permissions.rules.slice()
                    rules[i] = { ...rules[i], policy: e.target.value as Policy }
                    patch({ permissions: { ...draft.permissions, rules } })
                  }}
                >
                  <option value="ask">ask</option>
                  <option value="deny">deny</option>
                  <option value="allow_once">allow_once</option>
                  <option value="allow_always">allow_always</option>
                </select>
                <button
                  type="button"
                  className="comp-rule-del"
                  title="删除规则"
                  onClick={() =>
                    patch({
                      permissions: {
                        ...draft.permissions,
                        rules: draft.permissions.rules.filter((_, j) => j !== i),
                      },
                    })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="comp-btn"
              onClick={() =>
                patch({
                  permissions: {
                    ...draft.permissions,
                    rules: [...draft.permissions.rules, { match: '', policy: 'ask' } satisfies PermissionRule],
                  },
                })
              }
            >
              + 添加规则
            </button>
          </div>
        </>
      )
    case 'mcp':
      return (
        <>
          <label className="comp-field">
            <span className="comp-label">服务器（每行：名称 | command 或 url）</span>
            <textarea
              className="comp-input"
              rows={5}
              value={draft.mcp.servers.map(formatMcpServerLine).join('\n')}
              placeholder={'brave | npx -y @modelcontextprotocol/server-brave-search'}
              onChange={(e) => {
                const servers = e.target.value
                  .split('\n')
                  .map((line) => parseMcpServerLine(line))
                  .filter((s): s is NonNullable<typeof s> => s != null)
                patch({ mcp: { ...draft.mcp, servers } })
              }}
            />
          </label>
          <label className="comp-field">
            <span className="comp-label">停用 MCP 工具（server:tool，逗号分隔）</span>
            <input
              className="comp-input"
              value={Object.entries(draft.mcp.disabled_tools)
                .flatMap(([server, tools]) => tools.map((t) => `${server}:${t}`))
                .join(', ')}
              placeholder="如：brave:search"
              onChange={(e) => {
                const disabled_tools: Record<string, string[]> = {}
                for (const item of splitList(e.target.value)) {
                  const idx = item.indexOf(':')
                  if (idx <= 0) continue
                  const server = item.slice(0, idx).trim()
                  const tool = item.slice(idx + 1).trim()
                  if (!server || !tool) continue
                  disabled_tools[server] = [...(disabled_tools[server] || []), tool]
                }
                patch({ mcp: { ...draft.mcp, disabled_tools } })
              }}
            />
          </label>
        </>
      )
    case 'plugins':
      return (
        <label className="comp-field">
          <span className="comp-label">插件目录（绝对路径或相对工作区，逗号分隔）</span>
          <input
            className="comp-input"
            value={draft.plugins.dirs.join(', ')}
            placeholder="如：./plugins"
            onChange={(e) =>
              patch({ plugins: { ...draft.plugins, dirs: splitList(e.target.value) } })
            }
          />
        </label>
      )
    case 'flows':
      return (
        <label className="comp-field">
          <span className="comp-label">挂载已发布流程（id，逗号分隔；装配后可在对话中 /id 调用）</span>
          <input
            className="comp-input"
            value={(draft.flows ?? []).join(', ')}
            placeholder="如：demo-linear, review-pr"
            onChange={(e) => patch({ flows: splitList(e.target.value) })}
          />
        </label>
      )
  }
}
