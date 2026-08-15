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
  type CompositionData,
  type PermissionMode,
  type PermissionRule,
  type Policy,
} from '../lib/composition'

type Section = 'model' | 'tools' | 'permissions' | 'flows'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'model', label: '模型' },
  { id: 'tools', label: '工具' },
  { id: 'permissions', label: '权限' },
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
  const [section, setSection] = useState<Section>('model')
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
      pushToast('已应用：模型 / 工具停用 / 权限 / 流程', 'success')
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
            已接线：模型 · 工具停用 · 权限 · 流程。人设段落 / 技能 / MCP / 插件未下发
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
            <span className="comp-label">模型（会话级热切换）</span>
            <input
              className="comp-input"
              value={draft.model.name ?? ''}
              placeholder="留空 = 不动当前模型"
              onChange={(e) => patch({ model: { ...draft.model, name: e.target.value || null } })}
            />
          </label>
          <label className="comp-field">
            <span className="comp-label">推理强度</span>
            <select
              className="comp-input"
              value={draft.model.reasoning_effort ?? ''}
              onChange={(e) =>
                patch({ model: { ...draft.model, reasoning_effort: e.target.value || null } })
              }
            >
              <option value="">跟随默认</option>
              {['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </>
      )
    case 'tools':
      return (
        <label className="comp-field">
          <span className="comp-label">停用工具（官方函数名或别名 bash/search/edit/read/fetch）</span>
          <input
            className="comp-input"
            value={draft.tools.disable.join(', ')}
            placeholder="如：bash, web_search"
            onChange={(e) => patch({ tools: { ...draft.tools, disable: splitList(e.target.value) } })}
          />
        </label>
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
