/**
 * Agent 编制：工作台一等公民。左侧列表，右侧表单，写回 agents/<id>/。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'
import { pushToast } from '../../store'
import { deleteAgent, getAgent, listAgents, saveAgent } from '../bridge'
import type { AgentListItem } from '../types'
import { AGENT_CAPABILITY_LABEL } from '../types'
import { $agentsFocusId, clearAgentsFocus } from './focus'
import {
  CAPABILITY_OPTIONS,
  agentFromDraft,
  draftFromAgent,
  emptyFormDraft,
  parseCapability,
  validateAgentForm,
  type AgentFormDraft,
} from './form'

export default function AgentsPanel() {
  const focusId = useStore($agentsFocusId)
  const [list, setList] = useState<AgentListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<AgentFormDraft>(emptyFormDraft)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [focusFailed, setFocusFailed] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setList(await listAgents())
    } catch (e) {
      pushToast(`读取 Agent 列表失败：${String(e)}`, 'error')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadOne = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true)
    setCreating(false)
    try {
      const detail = await getAgent(id)
      const prompt = detail.systemPrompt ?? detail.system_prompt ?? ''
      setDraft(draftFromAgent(detail.agent, prompt))
      setSelectedId(id)
      setFocusFailed(null)
      return true
    } catch (e) {
      pushToast(`读取 Agent 失败：${String(e)}`, 'error')
      setFocusFailed(id)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!focusId) return
    void loadOne(focusId).then((ok) => {
      if (ok) clearAgentsFocus(focusId)
    })
  }, [focusId, loadOne])

  const onNew = () => {
    setCreating(true)
    setSelectedId(null)
    setDraft(emptyFormDraft())
  }

  const patch = (p: Partial<AgentFormDraft>) => setDraft((d) => ({ ...d, ...p }))

  const onSave = async () => {
    const err = validateAgentForm(draft)
    if (err) {
      pushToast(err, 'error')
      return
    }
    if (creating && list.some((a) => a.id === draft.id.trim())) {
      pushToast(`工号「${draft.id.trim()}」已存在，请换一个`, 'error')
      return
    }
    setBusy(true)
    try {
      const saved = await saveAgent(agentFromDraft(draft), draft.systemPrompt)
      pushToast(`已保存 Agent「${saved.id}」`, 'success')
      setCreating(false)
      setSelectedId(saved.id)
      setDraft(draftFromAgent(saved, draft.systemPrompt))
      await reload()
    } catch (e) {
      pushToast(`保存失败：${String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onCancel = () => {
    if (selectedId && !creating) {
      void loadOne(selectedId)
      return
    }
    setCreating(false)
    setSelectedId(null)
    setDraft(emptyFormDraft())
  }

  const onDelete = async () => {
    const id = selectedId
    if (!id) return
    if (!window.confirm(`删除 Agent「${id}」？引用它的流程下次编译会失败。`)) return
    setBusy(true)
    try {
      await deleteAgent(id)
      pushToast(`已删除 ${id}`, 'success')
      setSelectedId(null)
      setCreating(false)
      setDraft(emptyFormDraft())
      await reload()
    } catch (e) {
      pushToast(`删除失败：${String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const idLocked = !creating && Boolean(selectedId)
  const editing = creating || Boolean(selectedId)

  return (
    <div className="agents-panel" role="region" aria-label="Agent 编制">
      <aside className="agents-list" aria-label="我的 Agent">
        <div className="agents-list-head">
          <h2>Agent 编制</h2>
          <button type="button" className="agents-btn primary" onClick={onNew}>
            ＋ 新建
          </button>
        </div>
        {list.length === 0 ? (
          <p className="agents-empty">还没有编制员工。点「新建」或从画布升格。</p>
        ) : (
          <ul>
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`agents-item${selectedId === a.id && !creating ? ' is-active' : ''}`}
                  onClick={() => void loadOne(a.id)}
                >
                  <span className="agents-item-name">{a.name || a.id}</span>
                  <span className="agents-item-meta">
                    {a.id}
                    {a.capability ? ` · ${AGENT_CAPABILITY_LABEL[a.capability]}` : ''}
                    {a.isolation ? ' · 隔离' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="agents-form" aria-label="编辑 Agent">
        {focusId && focusFailed === focusId ? (
          <p className="agents-empty">
            打不开「{focusId}」。
            <button
              type="button"
              className="agents-btn"
              onClick={() => void loadOne(focusId).then((ok) => { if (ok) clearAgentsFocus(focusId) })}
            >
              重试
            </button>
          </p>
        ) : null}
        {!editing ? (
          <p className="agents-empty">从左侧选一个，或新建编制员工。</p>
        ) : loading ? (
          <p className="agents-empty">读取中…</p>
        ) : (
          <>
            <label className="agents-field">
              <span>显示名</span>
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="如：PR 审查员"
              />
            </label>
            <label className="agents-field">
              <span>id{idLocked ? '（已锁定）' : ''}</span>
              <input
                value={draft.id}
                disabled={idLocked}
                onChange={(e) => patch({ id: e.target.value.trim().toLowerCase() })}
                placeholder="如：pr-reviewer"
              />
            </label>
            <label className="agents-field">
              <span>版本</span>
              <input value={draft.version} onChange={(e) => patch({ version: e.target.value })} />
            </label>
            <label className="agents-field">
              <span>说明</span>
              <input
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="一句话岗位说明"
              />
            </label>

            <h3 className="agents-section">能力与权限</h3>
            <label className="agents-field">
              <span>能力档</span>
              <select
                value={draft.capability}
                onChange={(e) => patch({ capability: parseCapability(e.target.value) })}
              >
                {CAPABILITY_OPTIONS.map((o) => (
                  <option key={o.value || 'unset'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="agents-field agents-check">
              <input
                type="checkbox"
                checked={draft.isolation}
                onChange={(e) => patch({ isolation: e.target.checked })}
              />
              <span>在隔离区执行（隔离 git worktree，不碰主仓库）</span>
            </label>
            <label className="agents-field">
              <span>停用工具（官方函数名，逗号分隔）</span>
              <input
                value={draft.disabledToolsText}
                onChange={(e) => patch({ disabledToolsText: e.target.value })}
                placeholder="如：web_search, grep"
              />
            </label>
            <div className="agents-field">
              <span>deny 规则（kind:glob，如 edit:**/.env）</span>
              <div className="agents-rules">
                {draft.permissionRules.map((rule, i) => (
                  <div className="agents-rule" key={i}>
                    <input
                      value={rule}
                      placeholder="edit:**/.env"
                      onChange={(e) => {
                        const permissionRules = draft.permissionRules.slice()
                        permissionRules[i] = e.target.value
                        patch({ permissionRules })
                      }}
                    />
                    <button
                      type="button"
                      className="agents-rule-del"
                      title="删除规则"
                      onClick={() =>
                        patch({
                          permissionRules: draft.permissionRules.filter((_, j) => j !== i),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="agents-btn"
                  onClick={() => patch({ permissionRules: [...draft.permissionRules, ''] })}
                >
                  ＋ 添加规则
                </button>
              </div>
            </div>

            <h3 className="agents-section">人设</h3>
            <label className="agents-field">
              <span>system-prompt.md</span>
              <textarea
                rows={10}
                value={draft.systemPrompt}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
                placeholder="写给这个员工的系统提示"
              />
            </label>

            <footer className="agents-foot">
              {selectedId && !creating ? (
                <button type="button" className="agents-btn danger" disabled={busy} onClick={() => void onDelete()}>
                  删除
                </button>
              ) : null}
              <div className="agents-foot-spacer" />
              <button type="button" className="agents-btn" disabled={busy} onClick={onCancel}>
                取消
              </button>
              <button type="button" className="agents-btn primary" disabled={busy} onClick={() => void onSave()}>
                {busy ? '保存中…' : '保存'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
