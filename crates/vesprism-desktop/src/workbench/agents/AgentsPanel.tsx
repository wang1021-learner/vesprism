/**
 * Agent 编制：工作台一等公民。左侧列表，右侧表单，写回 agents/<id>/。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { listSkills } from '../../bridge'
import { parseOfficialSkills } from '../../lib/skillRows'
import { openChatTab } from '../../lib/openChatTab'
import { $activeTabId, $workspaceCwd, getTabState, pushToast } from '../../store'
import { deleteAgent, getAgent, listAgents, saveFlow, saveAgent } from '../bridge'
import type { AgentListItem } from '../types'
import type { FlowRecord } from '../flow'
import { AGENT_CAPABILITY_LABEL } from '../types'
import { requestFlowFocus } from '../flow/focus'
import { $agentsFocusId, clearAgentsFocus } from './focus'
import { findFlowsUsingAgent } from './refs'
import { markFlowsStale } from './stale'
import { SkillMountChips, ToolDisableChips } from './chips'
import {
  CAPABILITY_OPTIONS,
  agentFromDraft,
  draftFromAgent,
  emptyFormDraft,
  formFingerprint,
  isFormDirty,
  parseCapability,
  toggleNamed,
  validateAgentForm,
  type AgentFormDraft,
} from './form'

export default function AgentsPanel() {
  const focusId = useStore($agentsFocusId)
  const tabId = useStore($activeTabId)
  const cwd = useStore($workspaceCwd)
  const [list, setList] = useState<AgentListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<AgentFormDraft>(emptyFormDraft)
  const [baseline, setBaseline] = useState(formFingerprint(emptyFormDraft()))
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [focusFailed, setFocusFailed] = useState<string | null>(null)
  const [usedByFlows, setUsedByFlows] = useState<Array<{ id: string; name: string }>>([])
  const [skillOptions, setSkillOptions] = useState<Array<{ name: string; label: string }>>([])
  const [deletionConflict, setDeletionConflict] = useState<{
    agentId: string
    flows: Array<{ id: string; name: string }>
    detailedFlows: FlowRecord[]
  } | null>(null)
  const dirty = isFormDirty(draft, baseline)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

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

  useEffect(() => {
    const sid = tabId
    if (!sid) return
    const sessionCwd = getTabState(sid)?.cwd || cwd || '.'
    void listSkills(sid, sessionCwd)
      .then((resp) => {
        const rows = parseOfficialSkills(Array.isArray(resp?.skills) ? resp.skills : [])
        setSkillOptions(rows.map((s) => ({ name: s.name, label: s.displayName || s.name })))
      })
      .catch(() => setSkillOptions([]))
  }, [tabId, cwd])

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [])

  const confirmLeave = () => {
    if (!dirtyRef.current) return true
    return window.confirm('有未保存的编制改动，离开将丢失。确定离开？')
  }

  const loadTokenRef = useRef(0)

  const loadOne = useCallback(async (id: string): Promise<boolean> => {
    const token = ++loadTokenRef.current
    setLoading(true)
    try {
      const detail = await getAgent(id)
      if (token !== loadTokenRef.current) return false
      const prompt = detail.systemPrompt ?? detail.system_prompt ?? ''
      setCreating(false)
      const next = draftFromAgent(detail.agent, prompt)
      setDraft(next)
      setBaseline(formFingerprint(next))
      setSelectedId(id)
      setFocusFailed(null)

      try {
        const matched = await findFlowsUsingAgent(id)
        if (token === loadTokenRef.current) {
          setUsedByFlows(matched.map((f) => ({ id: f.id, name: f.name })))
        }
      } catch {
        if (token === loadTokenRef.current) {
          setUsedByFlows([])
        }
      }

      return true
    } catch (e) {
      if (token === loadTokenRef.current) {
        pushToast(`读取 Agent 失败：${String(e)}`, 'error')
        setFocusFailed(id)
        setSelectedId(id)
      }
      return false
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!focusId) return
    if (dirtyRef.current && !window.confirm('有未保存的编制改动，打开另一位员工将丢失。确定离开？')) {
      clearAgentsFocus(focusId)
      return
    }
    void loadOne(focusId).then((ok) => {
      if (ok) clearAgentsFocus(focusId)
    })
  }, [focusId, loadOne])

  const onNew = () => {
    if (!confirmLeave()) return
    loadTokenRef.current++
    setCreating(true)
    setSelectedId(null)
    const blank = emptyFormDraft()
    setDraft(blank)
    setBaseline(formFingerprint(blank))
    setUsedByFlows([])
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
      setCreating(false)
      setSelectedId(saved.id)
      const next = draftFromAgent(saved, draft.systemPrompt)
      setDraft(next)
      setBaseline(formFingerprint(next))
      await reload()
      const refs = await findFlowsUsingAgent(saved.id)
      setUsedByFlows(refs.map((f) => ({ id: f.id, name: f.name })))
      const published = refs.filter((f) => f.published)
      if (published.length > 0) {
        markFlowsStale(
          saved.id,
          published.map((f) => ({ id: f.id, name: f.name })),
        )
        pushToast(
          `已保存「${saved.id}」。${published.length} 个已发布流程仍用旧权限，请到画布重新发布：${published.map((f) => f.name).join('、')}`,
          'info',
        )
      } else {
        pushToast(`已保存 Agent「${saved.id}」`, 'success')
      }
    } catch (e) {
      pushToast(`保存失败：${String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onCancel = () => {
    if (dirty && !window.confirm('放弃未保存的编制改动？')) return
    if (selectedId && !creating) {
      void loadOne(selectedId)
      return
    }
    setCreating(false)
    setSelectedId(null)
    const blank = emptyFormDraft()
    setDraft(blank)
    setBaseline(formFingerprint(blank))
  }

  const onDelete = async () => {
    const id = selectedId
    if (!id) return
    setBusy(true)
    try {
      const refs = await findFlowsUsingAgent(id)
      const dependentFlows = refs.map((f) => ({ id: f.id, name: f.name }))
      const detailedFlows = refs.map((f) => f.record)
      if (dependentFlows.length > 0) {
        setDeletionConflict({ agentId: id, flows: dependentFlows, detailedFlows })
        setBusy(false)
        return
      }
      if (!window.confirm(`确认删除 Agent 编制「${id}」？`)) {
        setBusy(false)
        return
      }
      await performDelete(id)
    } catch (e) {
      pushToast(`检查依赖失败：${String(e)}`, 'error')
      setBusy(false)
    }
  }

  const performDelete = async (id: string) => {
    setBusy(true)
    try {
      await deleteAgent(id)
      pushToast(`已删除 ${id}`, 'success')
      setSelectedId(null)
      setCreating(false)
      const blank = emptyFormDraft()
      setDraft(blank)
      setBaseline(formFingerprint(blank))
      setDeletionConflict(null)
      await reload()
    } catch (e) {
      pushToast(`删除失败：${String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onDemoteAndDelete = async () => {
    if (!deletionConflict) return
    const { agentId, detailedFlows } = deletionConflict
    setBusy(true)
    try {
      let fallbackName = draft.name
      let fallbackPrompt = draft.systemPrompt
      let fallbackModel = draft.raw?.model
      try {
        const agDetail = await getAgent(agentId)
        fallbackName = agDetail.agent.name || fallbackName
        fallbackPrompt = agDetail.systemPrompt ?? agDetail.system_prompt ?? fallbackPrompt
        fallbackModel = agDetail.agent.model ?? fallbackModel
      } catch {
        /* ignore */
      }

      for (const flow of detailedFlows) {
        if (!Array.isArray(flow.nodes)) continue
        const updatedNodes = flow.nodes.map((n) => {
          if ((n.params as { presetId?: string }).presetId === agentId) {
            return {
              ...n,
              params: {
                ...n.params,
                presetId: '',
                role: (n.params as { role?: string }).role || fallbackName || '',
                prompt: (n.params as { prompt?: string }).prompt || fallbackPrompt || '',
                model: (n.params as { model?: string }).model || fallbackModel || '',
              },
            }
          }
          return n
        })
        await saveFlow({
          id: flow.id,
          name: flow.name,
          description: flow.description,
          version: flow.version,
          input_schema: flow.input_schema,
          output_schema: flow.output_schema,
          nodes: updatedNodes,
          edges: flow.edges,
        })
      }
      pushToast(`已将 ${detailedFlows.length} 个流程中的节点解绑并降级为试岗`, 'info')
      await performDelete(agentId)
    } catch (e) {
      pushToast(`降级解绑失败: ${String(e)}`, 'error')
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
                  className={`agents-item${selectedId === a.id && !creating ? ' is-active' : ''}${a.error ? ' is-corrupt' : ''}`}
                  onClick={() => {
                    if (a.error) {
                      pushToast(`Agent 档案损坏：${a.error}`, 'error')
                    }
                    if (selectedId === a.id && !creating) return
                    if (!confirmLeave()) return
                    void loadOne(a.id)
                  }}
                  title={a.error ? `档案损坏：${a.error}` : undefined}
                >
                  <span className="agents-item-name">{a.name || a.id}</span>
                  <span className="agents-item-meta">
                    {a.error ? (
                      <span className="agents-badge-err">⚠️ 档案损坏</span>
                    ) : (
                      <>
                        {a.id}
                        {a.capability ? ` · ${AGENT_CAPABILITY_LABEL[a.capability]}` : ''}
                        {a.isolation ? ' · 隔离' : ''}
                      </>
                    )}
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
            <div className="agents-field">
              <span>停用工具（勾选即写入 disabled_tools）</span>
              <ToolDisableChips
                value={draft.disabledToolsText}
                extraNames={[]}
                onToggle={(name) => patch({ disabledToolsText: toggleNamed(draft.disabledToolsText, name) })}
              />
              <input
                value={draft.disabledToolsText}
                onChange={(e) => patch({ disabledToolsText: e.target.value })}
                placeholder="也可手填官方函数名，逗号分隔"
                aria-label="停用工具名单"
              />
            </div>
            <div className="agents-field">
              <span>挂载技能（勾选写入 skills）</span>
              <SkillMountChips
                value={draft.skillsText}
                options={skillOptions}
                onToggle={(name) => patch({ skillsText: toggleNamed(draft.skillsText, name) })}
              />
              <input
                value={draft.skillsText}
                onChange={(e) => patch({ skillsText: e.target.value })}
                placeholder="也可手填技能名，逗号分隔"
                aria-label="挂载技能名单"
              />
            </div>
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

            {selectedId && !creating && (
              <div className="agents-field">
                <span>引用此编制的流程 ({usedByFlows.length})</span>
                {usedByFlows.length === 0 ? (
                  <div className="agents-hint" style={{ padding: '4px 0', color: 'var(--text-tertiary, #9ca3af)', fontSize: '11.5px' }}>
                    暂无流程引用此 Agent（独立编制）。
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                    {usedByFlows.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="agents-flow-chip"
                        title={`打开流程 ${f.id}`}
                        onClick={() => {
                          if (!confirmLeave()) return
                          requestFlowFocus(f.id)
                          void openChatTab({ title: '流程画布', utilityKind: 'flow-canvas' })
                        }}
                      >
                        🔗 {f.name} <span className="agents-flow-chip-id">({f.id})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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
              {dirty ? <span className="agents-dirty">未保存</span> : null}
              <button type="button" className="agents-btn" disabled={busy} onClick={onCancel}>
                取消
              </button>
              <button type="button" className="agents-btn primary" disabled={busy || !dirty} onClick={() => void onSave()}>
                {busy ? '保存中…' : '保存'}
              </button>
            </footer>
          </>
        )}
      </section>

      {deletionConflict && (
        <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="删除依赖保护">
          <div className="flow-modal" style={{ maxWidth: '440px' }}>
            <h2 style={{ color: '#dc2626' }}>⚠️ 依赖保护警告</h2>
            <p className="flow-field-hint" style={{ color: 'var(--text-primary, #111827)' }}>
              Agent 编制「<strong>{deletionConflict.agentId}</strong>」当前正被以下 <strong>{deletionConflict.flows.length}</strong> 个流程引用：
            </p>
            <div
              style={{
                maxHeight: '140px',
                overflowY: 'auto',
                background: 'var(--surface-muted, #f3f4f6)',
                padding: '8px 12px',
                borderRadius: '6px',
                margin: '8px 0 12px',
              }}
            >
              {deletionConflict.flows.map((f) => (
                <div key={f.id} style={{ fontSize: '12px', padding: '3px 0' }}>
                  • <strong>{f.name}</strong> <span style={{ color: '#6b7280' }}>({f.id})</span>
                </div>
              ))}
            </div>
            <p className="flow-field-hint">
              如果直接强行删除，这些流程下次打开或编译时将会报错中断。建议选择「转为试岗并删除编制」，自动将人设保存在节点本地。
            </p>
            <div className="flow-modal-actions" style={{ marginTop: '16px', gap: '8px' }}>
              <button type="button" className="flow-btn" onClick={() => setDeletionConflict(null)}>
                取消
              </button>
              <button type="button" className="flow-btn primary" onClick={onDemoteAndDelete} disabled={busy}>
                转为试岗并删除
              </button>
              <button
                type="button"
                className="flow-btn danger"
                onClick={() => performDelete(deletionConflict.agentId)}
                disabled={busy}
              >
                强行删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
