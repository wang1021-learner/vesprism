/**
 * 技能面板 — 可复用提示包（SKILL.md）。启停写入本机配置，不是只关当前对话。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  $composerInput,
  $settingsOpen,
  $utilityKind,
  $workspaceCwd,
  findNormalChatTab,
  patchActiveTab,
  patchTab,
  pushToast,
  switchTab,
} from '../store'
import { useCodingSessionTabId } from '../lib/codingSession'
import { Notice } from './Notice'
import {
  addSkill,
  listCatalogSkills,
  listSessionCommands,
  listSkills,
  readFileText,
  removeSkill,
  toggleSkill,
  type SkillInfoDto,
} from '../bridge'
import {
  isSkillAddPath,
  parseOfficialSkills,
  parseSkillsFromCommands,
  skillPreviewBody,
  skillScopeBucket,
  skillScopeLabel,
  SKILL_SCOPE_BUCKET_LABEL,
  SKILL_SCOPE_BUCKET_ORDER,
  type SkillRow,
} from '../lib/skillRows'

type EnabledFilter = 'all' | 'on' | 'off'

export function SkillsPanel() {
  const tabId = useCodingSessionTabId()
  const cwd = useStore($workspaceCwd)
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<string | 'all'>('all')
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all')
  const [addPath, setAddPath] = useState('')
  const [busyName, setBusyName] = useState('')
  const [previewName, setPreviewName] = useState('')
  const [previewBody, setPreviewBody] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [confirmBulkOff, setConfirmBulkOff] = useState(false)

  const applyOfficial = (raw: SkillInfoDto[] | undefined) => {
    if (!raw?.length) return false
    setSkills(parseOfficialSkills(raw))
    return true
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (tabId) {
        try {
          const official = await listSkills(tabId, cwd || '.')
          const list = Array.isArray(official?.skills) ? official.skills : []
          if (applyOfficial(list)) return
          const resp = await listSessionCommands(tabId, cwd || undefined)
          const cmds = Array.isArray(resp?.commands) ? resp.commands : []
          if (cmds.length) {
            setSkills(parseSkillsFromCommands(cmds))
            return
          }
        } catch {
          /* 无会话时扫磁盘 */
        }
      }
      const cat = await listCatalogSkills(cwd || null)
      const list = Array.isArray(cat?.skills) ? cat.skills : []
      if (!applyOfficial(list)) setSkills([])
    } catch (e) {
      setError(String(e))
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [tabId, cwd])

  useEffect(() => {
    void load()
  }, [load])

  const scopesPresent = useMemo(() => {
    const s = new Set(skills.map((x) => skillScopeBucket(x.scope)))
    return SKILL_SCOPE_BUCKET_ORDER.filter((x) => s.has(x))
  }, [skills])

  const enabledCount = useMemo(
    () => skills.filter((s) => s.enabled).length,
    [skills],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter((sk) => {
      if (scopeFilter !== 'all' && skillScopeBucket(sk.scope) !== scopeFilter) return false
      if (enabledFilter === 'on' && !sk.enabled) return false
      if (enabledFilter === 'off' && sk.enabled) return false
      if (!q) return true
      return (
        sk.name.toLowerCase().includes(q) ||
        sk.displayName.toLowerCase().includes(q) ||
        sk.description.toLowerCase().includes(q) ||
        sk.path.toLowerCase().includes(q)
      )
    })
  }, [skills, query, scopeFilter, enabledFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, SkillRow[]>()
    for (const sk of filtered) {
      const bucket = skillScopeBucket(sk.scope)
      const list = map.get(bucket) || []
      list.push(sk)
      map.set(bucket, list)
    }
    return [...SKILL_SCOPE_BUCKET_ORDER, ...map.keys()]
      .filter((k, i, arr) => map.has(k) && arr.indexOf(k) === i)
      .map((scope) => ({ scope, items: map.get(scope)! }))
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

  /** 填入输入框、关掉设置、回到对话（勿命名 use*） */
  const fillInChat = (sk: SkillRow) => {
    $composerInput.set(`/${sk.name} `)
    $settingsOpen.set(false)
    $utilityKind.set(null)
    const chat = findNormalChatTab(false)
    if (chat) {
      switchTab(chat)
      patchTab(chat, { utilityKind: null })
    } else {
      patchActiveTab({ utilityKind: null, chatTitle: '' })
    }
    const hint = sk.argumentHint ? `，参数：${sk.argumentHint}` : ''
    pushToast(`已填入 /${sk.name}${hint}，可直接发送`, 'success')
  }

  const onToggle = async (sk: SkillRow) => {
    if (!tabId || busyName) return
    setBusyName(sk.name)
    try {
      const resp = await toggleSkill(tabId, sk.name, !sk.enabled, cwd || '.')
      if (!applyOfficial(resp?.skills)) await load()
      pushToast(
        sk.enabled
          ? `已停用 /${sk.name}（写入本机配置，之后的对话都没有它）`
          : `已启用 /${sk.name}（之后的对话都会带上）`,
        'success',
      )
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyName('')
    }
  }

  const bulkToggle = async (enabled: boolean) => {
    if (!tabId || busyName) return
    const targets = skills.filter((s) => s.enabled !== enabled)
    if (targets.length === 0) return
    setBusyName('__bulk__')
    setConfirmBulkOff(false)
    try {
      let last: SkillInfoDto[] | undefined
      for (const sk of targets) {
        const resp = await toggleSkill(tabId, sk.name, enabled, cwd || '.')
        last = resp?.skills
      }
      if (!applyOfficial(last)) await load()
      pushToast(
        enabled
          ? `已启用 ${targets.length} 个技能（之后的对话生效）`
          : `已停用 ${targets.length} 个技能（写入本机配置，含内置）`,
        'success',
      )
    } catch (e) {
      pushToast(String(e), 'error')
      await load()
    } finally {
      setBusyName('')
    }
  }

  const submitAdd = async (path: string) => {
    const trimmed = path.trim()
    if (!tabId || !trimmed) return
    if (!isSkillAddPath(trimmed)) {
      pushToast('请选择技能文件夹，或名为 SKILL.md 的文件', 'error')
      return
    }
    setBusyName('__add__')
    try {
      const resp = await addSkill(tabId, trimmed, cwd || '.')
      if (!applyOfficial(resp?.skills)) await load()
      setAddPath('')
      pushToast(resp?.message || '已登记到本机配置。列表里可「移除登记」，磁盘文件还在。', 'success')
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyName('')
    }
  }

  const pickSkillFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        title: '选择技能文件夹（内含 SKILL.md）',
      })
      if (typeof selected === 'string') await submitAdd(selected)
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const pickSkillFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        title: '选择 SKILL.md',
        filters: [{ name: 'SKILL.md', extensions: ['md'] }],
      })
      if (typeof selected === 'string') await submitAdd(selected)
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const onRemove = async (sk: SkillRow) => {
    if (!tabId || !sk.path || busyName) return
    setBusyName(sk.name)
    try {
      const resp = await removeSkill(tabId, sk.path, cwd || '.')
      if (!applyOfficial(resp?.skills)) await load()
      if (previewName === sk.name) {
        setPreviewName('')
        setPreviewBody('')
      }
      pushToast(resp?.message || '已从本机配置拿掉这条路径（磁盘文件还在）', 'success')
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusyName('')
    }
  }

  const togglePreview = async (sk: SkillRow) => {
    if (previewName === sk.name) {
      setPreviewName('')
      setPreviewBody('')
      setPreviewError('')
      return
    }
    setPreviewName(sk.name)
    setPreviewBody('')
    setPreviewError('')
    if (!sk.path) {
      setPreviewError('没有 SKILL.md 路径')
      return
    }
    try {
      const text = await readFileText(sk.path)
      setPreviewBody(skillPreviewBody(String(text || '')))
    } catch (e) {
      setPreviewError(String(e))
    }
  }

  return (
    <div className="skills-panel" role="region" aria-label="技能">
      <div className="skills-panel-inner">
        <header className="skills-panel-head">
          <div className="skills-panel-titles">
            <h2 className="skills-panel-title">技能</h2>
            <p className="skills-panel-desc">
              可复用的提示包，不是工具。对话里输入 <code>/名称</code> 即可调用。
              停用会写入本机配置，之后<strong>所有对话</strong>都不再用它，不是只关这一场。
            </p>
          </div>
          <div className="skills-panel-actions">
            <span className="skills-panel-stats">
              {enabledCount}/{skills.length} 已启用
            </span>
            <button
              type="button"
              className="skills-btn"
              disabled={loading || !tabId || busyName === '__bulk__' || skills.length === 0}
              onClick={() => {
                const turningOn = enabledCount < skills.length
                if (turningOn) {
                  setConfirmBulkOff(false)
                  void bulkToggle(true)
                  return
                }
                if (!confirmBulkOff) {
                  setConfirmBulkOff(true)
                  return
                }
                void bulkToggle(false)
              }}
              title={
                enabledCount < skills.length
                  ? '启用当前列表里还没开的技能（写入本机配置）'
                  : confirmBulkOff
                    ? '再点一次：停用全部（含内置，之后所有对话生效）'
                    : '停用全部会写入本机配置，含内置技能'
              }
            >
              {enabledCount < skills.length
                ? '全部启用'
                : confirmBulkOff
                  ? `再点确认：停用全部 ${skills.length} 个`
                  : '全部停用'}
            </button>
            <button
              type="button"
              className="skills-btn"
              disabled={loading || !tabId}
              onClick={() => {
                setConfirmBulkOff(false)
                void load()
              }}
            >
              {loading ? '扫描中…' : '刷新'}
            </button>
          </div>
        </header>

        <div className="skills-toolbar">
          <input
            className="skills-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称 / 用途…"
          />
        </div>
        {!tabId ? (
          <p className="skills-banner" role="status">
            添加、启用、停用需要先在编码里开一场对话。下面仍可浏览已发现的技能。
          </p>
        ) : null}
        <p className="skills-add-hint">
          两条路：跟仓库走，把 <code>SKILL.md</code> 放到{' '}
          <code>.grok/skills/名称/</code> 再刷新；跟本机走，用下面按钮把文件夹登记到配置（列表里可「移除登记」，不删磁盘文件）。
        </p>
        <div className="skills-add-row">
          <button
            type="button"
            className="skills-btn primary"
            disabled={busyName === '__add__' || !tabId}
            title="登记到本机配置，不复制文件"
            onClick={() => void pickSkillFolder()}
          >
            选文件夹（本机登记）
          </button>
          <button
            type="button"
            className="skills-btn"
            disabled={busyName === '__add__' || !tabId}
            title="选 SKILL.md，同样写入本机配置"
            onClick={() => void pickSkillFile()}
          >
            选 SKILL.md
          </button>
          <input
            className="skills-search"
            type="text"
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            placeholder="或粘贴绝对路径"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitAdd(addPath)
            }}
          />
          <button
            type="button"
            className="skills-btn"
            disabled={!addPath.trim() || busyName === '__add__' || !tabId}
            onClick={() => void submitAdd(addPath)}
          >
            登记
          </button>
        </div>

        <div className="skills-scope-row">
          <button
            type="button"
            className={`skills-scope-chip${enabledFilter === 'all' ? ' is-active' : ''}`}
            onClick={() => setEnabledFilter('all')}
          >
            全部
          </button>
          <button
            type="button"
            className={`skills-scope-chip${enabledFilter === 'on' ? ' is-active' : ''}`}
            onClick={() => setEnabledFilter('on')}
          >
            已启用
          </button>
          <button
            type="button"
            className={`skills-scope-chip${enabledFilter === 'off' ? ' is-active' : ''}`}
            onClick={() => setEnabledFilter('off')}
          >
            已停用
          </button>
          {scopesPresent.map((s) => (
            <button
              key={s}
              type="button"
              className={`skills-scope-chip${scopeFilter === s ? ' is-active' : ''}`}
              onClick={() => setScopeFilter(scopeFilter === s ? 'all' : s)}
            >
              {SKILL_SCOPE_BUCKET_LABEL[s] || s}
            </button>
          ))}
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
        ) : loading && skills.length === 0 ? (
          <div className="skills-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="skills-empty">
            {skills.length === 0 ? (
              <>
                还没有技能。跟仓库走：把 <code>SKILL.md</code> 放到{' '}
                <code>.grok/skills/名称/</code> 再刷新。跟本机走：用「选文件夹」登记路径。
              </>
            ) : (
              '没有匹配的技能。'
            )}
          </div>
        ) : (
          <div className="skills-groups">
            {grouped.map(({ scope, items }) => (
              <section key={scope} className="skills-group">
                <h3 className="skills-group-title">
                  {SKILL_SCOPE_BUCKET_LABEL[scope] || skillScopeLabel(scope)}
                  <span className="skills-group-count">{items.length}</span>
                </h3>
                <ul className="skills-list">
                  {items.map((sk) => (
                    <li
                      key={`${sk.scope}:${sk.path}:${sk.name}`}
                      className={`skills-card${sk.enabled ? '' : ' is-disabled'}`}
                    >
                      <div className="skills-card-main">
                        <div className="skills-card-titles">
                          <span className="skills-card-label">
                            {sk.displayName}
                          </span>
                          <code className="skills-card-slash">/{sk.name}</code>
                          <span className={`skills-pill scope-${sk.scope}`}>
                            {skillScopeLabel(sk.scope)}
                          </span>
                          {sk.plugin ? (
                            <span className="skills-pill">插件 {sk.plugin}</span>
                          ) : null}
                          {!sk.enabled ? (
                            <span className="skills-pill is-off">已停用</span>
                          ) : null}
                          {!sk.userInvocable ? (
                            <span className="skills-pill">只能模型自己用</span>
                          ) : null}
                          {sk.disableModelInvocation ? (
                            <span className="skills-pill">只能斜杠</span>
                          ) : null}
                        </div>
                        <p className="skills-card-purpose">
                          <span className="skills-card-purpose-label">用途</span>
                          <span className="skills-card-purpose-text">
                            {sk.description}
                          </span>
                        </p>
                        {sk.whenToUse ? (
                          <p className="skills-card-hint">何时用：{sk.whenToUse}</p>
                        ) : null}
                        <div className="skills-card-path" title={sk.path}>
                          {sk.path}
                        </div>
                        {sk.argumentHint ? (
                          <div className="skills-card-hint">
                            参数：{sk.argumentHint}
                          </div>
                        ) : null}
                        {sk.allowedTools && sk.allowedTools.length > 0 ? (
                          <div className="skills-card-hint">
                            这篇提示包声明可用：{sk.allowedTools.join(', ')}
                            （不是「工具」页的开关）
                          </div>
                        ) : null}
                        {previewName === sk.name ? (
                          previewError ? (
                            <div className="skills-card-hint">{previewError}</div>
                          ) : previewBody ? (
                            <pre className="skills-code">{previewBody}</pre>
                          ) : (
                            <div className="skills-card-hint">读取 SKILL.md…</div>
                          )
                        ) : null}
                      </div>
                      <div className="skills-card-ops">
                        <button
                          type="button"
                          className="skills-btn ghost"
                          disabled={busyName === sk.name || busyName === '__bulk__'}
                          title={
                            sk.enabled
                              ? '停用后写入本机配置，之后所有对话都没有它'
                              : '启用后写入本机配置，之后的对话都会带上'
                          }
                          onClick={() => void onToggle(sk)}
                        >
                          {sk.enabled ? '停用' : '启用'}
                        </button>
                        <button
                          type="button"
                          className="skills-btn ghost"
                          onClick={() => void togglePreview(sk)}
                        >
                          {previewName === sk.name ? '收起' : '预览'}
                        </button>
                        {sk.removable ? (
                          <button
                            type="button"
                            className="skills-btn ghost"
                            disabled={busyName === sk.name || !sk.path}
                            title="从本机配置拿掉这条路径，不删磁盘上的文件"
                            onClick={() => void onRemove(sk)}
                          >
                            移除登记
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="skills-btn ghost"
                          onClick={() => void copySlash(sk.name)}
                        >
                          复制
                        </button>
                        {sk.userInvocable && sk.enabled ? (
                          <button
                            type="button"
                            className="skills-btn primary"
                            onClick={() => fillInChat(sk)}
                            title="填入输入框，关闭设置，回到对话"
                          >
                            使用
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
