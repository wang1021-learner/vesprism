/**
 * 设置弹窗 — 对齐重构前样式与交互：
 * 左侧「通用 / 模型」导航 · 模型列表 + 详情 · 连接/推理/密钥/高级折叠
 */
import { useStore } from '@nanostores/react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  $activeTabId,
  $defaultModelId,
  $messages,
  $models,
  $reasoningEffort,
  $settingsOpen,
  $settingsSection,
  $workspaceCwd,
  $preferredWorkspaceCwd,
  $securityPolicy,
  $sessionPolicyOverride,
  getTabState,
  patchActiveTab,
} from '../store'
import {
  envFileLocation,
  getEnvStatus,
  getModelSettings,
  probeModelEndpoint,
  reloadModels,
  saveEnvKey,
  saveModelSettings,
  setCurrentModel,
  setWorkspaceCwd,
  getSecurityPolicy,
  setSecurityPolicy,
  restartSession,
} from '../bridge'
import { policyFromDto, type ExecutionPolicy, type FileAccess, type InternetAccess } from '../lib/executionPolicy'
import {
  autoEnvKey,
  normalizeModelFromDisk,
  parseHeadersText,
  prepareModelsForSave,
} from '../lib/models'
import {
  applyVendorTemplate,
  envKeyChoices,
  hostFromBaseUrl,
  MODEL_VENDOR_TEMPLATES,
  type ModelVendorId,
} from '../lib/modelTemplates'
import type { ModelInfo } from '../types'
import { ModelSamplingFields } from './ModelSamplingFields'
import { SettingsHelp, SettingsLabel } from './SettingsHelp'
import {
  API_BACKENDS,
  headersToText,
  textToHeaders,
  type SettingsTab,
} from './settingsHelpers'
import { EngineSettings } from './EngineSettings'
import { HooksSettings } from './HooksSettings'
import { McpPanel } from './McpPanel'
import { ToolsPanel } from './ToolsPanel'
import { SkillsPanel } from './SkillsPanel'
import { MemoryPanel } from './MemoryPanel'
import { PluginsPanel } from './PluginsPanel'
import type { SettingsSection } from '../store'

function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function SettingsSessionGate({ children }: { children: ReactNode }) {
  return <div className="settings-embed">{children}</div>
}

export function SettingsModal() {
  const open = useStore($settingsOpen)
  const messages = useStore($messages)
  const canSwitchWorkspace = !messages.some((m) => m.role === 'user')

  const tab = useStore($settingsSection) as SettingsTab
  const setTab = (next: SettingsTab) => $settingsSection.set(next as SettingsSection)
  const CAPABILITY_TABS: SettingsTab[] = ['skills', 'tools', 'mcp', 'memory', 'plugins']
  const isCapability = CAPABILITY_TABS.includes(tab)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(
    null,
  )

  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [defaultId, setDefaultId] = useState('')
  const [settingsCwd, setSettingsCwd] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [envFilePath, setEnvFilePath] = useState('')
  const [modelConfigPath, setModelConfigPath] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [keyStatus, setKeyStatus] = useState<{ key_name: string; is_set: boolean } | null>(
    null,
  )
  const [draftModelIds, setDraftModelIds] = useState<string[]>([])
  const [headersDraft, setHeadersDraft] = useState<string | null>(null)
  const [queryDraft, setQueryDraft] = useState<string | null>(null)
  const [envHeaderDraft, setEnvHeaderDraft] = useState<string | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeMsg, setProbeMsg] = useState('')
  const [probeOk, setProbeOk] = useState<boolean | null>(null)
  /** 已配置密钥时，点「更新」才显示输入框 */
  const [forceKeyEdit, setForceKeyEdit] = useState(false)
  const [execPolicy, setExecPolicy] = useState<ExecutionPolicy>('request-review')
  const [internetAccess, setInternetAccess] = useState<InternetAccess>('ask')
  const [fileAccess, setFileAccess] = useState<FileAccess>('workspace-only')
  const [policyScope, setPolicyScope] = useState<'global' | 'workspace'>('global')

  const engineSaveRef = useRef<(() => Promise<void>) | null>(null)
  const hooksSaveRef = useRef<(() => Promise<void>) | null>(null)
  const bindEngineSave = useCallback((fn: (() => Promise<void>) | null) => {
    engineSaveRef.current = fn
  }, [])
  const bindHooksSave = useCallback((fn: (() => Promise<void>) | null) => {
    hooksSaveRef.current = fn
  }, [])

  const selectedModel = models.find((m) => m.id === selectedModelId)
  const isDraft = selectedModelId ? draftModelIds.includes(selectedModelId) : false

  const headersText = useMemo(
    () => headersToText(selectedModel?.extra_headers),
    [selectedModel?.extra_headers],
  )
  const headersValue =
    headersDraft !== null && selectedModel ? headersDraft : headersText
  const queryText = useMemo(
    () => headersToText(selectedModel?.query_params),
    [selectedModel?.query_params],
  )
  const queryValue = queryDraft !== null && selectedModel ? queryDraft : queryText
  const envHeaderText = useMemo(
    () => headersToText(selectedModel?.env_http_headers),
    [selectedModel?.env_http_headers],
  )
  const envHeaderValue =
    envHeaderDraft !== null && selectedModel ? envHeaderDraft : envHeaderText
  const keyChoices = useMemo(() => envKeyChoices(models), [models])

  const refreshKeyStatus = async (envKey: string) => {
    const name = envKey.trim()
    if (!name) {
      setKeyStatus(null)
      return
    }
    try {
      setKeyStatus(await getEnvStatus(name))
    } catch {
      setKeyStatus({ key_name: name, is_set: false })
    }
  }

  useEffect(() => {
    if (!open) return
    setTab('models')
    setShowAdvanced(false)
    setToast(null)
    setKeyInput('')
    setKeyVisible(false)
    setDraftModelIds([])
    setHeadersDraft(null)
    setQueryDraft(null)
    setEnvHeaderDraft(null)
    setForceKeyEdit(false)
    setProbeMsg('')
    setProbeOk(null)
    void (async () => {
      try {
        const s = await getModelSettings()
        const normalized = s.models.map((m) => normalizeModelFromDisk(m))
        setModels(normalized)
        setModelConfigPath(s.config_path || '')
        const pick =
          s.default_id && normalized.some((m) => m.id === s.default_id)
            ? s.default_id
            : (normalized[0]?.id ?? '')
        setDefaultId(pick)
        setSelectedModelId(pick)
        try {
          const pol = policyFromDto(await getSecurityPolicy(settingsCwd || $workspaceCwd.get()))
          setExecPolicy(pol.executionPolicy)
          setInternetAccess(pol.internetAccess)
          setFileAccess(pol.fileAccess)
          setPolicyScope(pol.scope)
        } catch {
          /* 默认审批模式 */
        }
        setSettingsCwd($workspaceCwd.get())
        const entry = normalized.find((m) => m.id === pick)
        await refreshKeyStatus(entry?.env_key || '')
        try {
          setEnvFilePath(await envFileLocation())
        } catch {
          setEnvFilePath('')
        }
      } catch (e) {
        setToast({ message: String(e), type: 'error' })
      }
    })()
  }, [open])

  if (!open) return null

  const updateSelectedModel = (patch: Partial<ModelInfo>) => {
    if (!selectedModelId) return
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== selectedModelId) return m
        const next = { ...m, ...patch }
        if (patch.model != null) next.name = patch.model
        return next
      }),
    )
  }

  const selectModel = (id: string) => {
    setHeadersDraft(null)
    setQueryDraft(null)
    setEnvHeaderDraft(null)
    setShowAdvanced(false)
    setSelectedModelId(id)
    setKeyInput('')
    setKeyVisible(false)
    setForceKeyEdit(false)
    setProbeMsg('')
    setProbeOk(null)
    const entry = models.find((m) => m.id === id)
    void refreshKeyStatus(entry?.env_key || '')
  }

  const onSelectModel = (id: string) => {
    setHeadersDraft(null)
    setShowAdvanced(false)
    selectModel(id)
  }

  const startAddModel = (vendor: ModelVendorId = 'copy') => {
    const existing = new Set(models.map((m) => m.id))
    let id = ''
    for (let i = 0; i < 16; i++) {
      const c = `m-${shortId()}`
      if (!existing.has(c)) {
        id = c
        break
      }
    }
    if (!id) id = `m-${shortId()}`
    const current = models.find((m) => m.id === selectedModelId) ?? models[0]
    const draft = applyVendorTemplate(id, vendor, current)
    setModels((prev) => [...prev, draft])
    setDraftModelIds((prev) => [...prev, id])
    setSelectedModelId(id)
    setDefaultId((d) => d || id)
    setKeyInput('')
    setKeyVisible(false)
    setHeadersDraft(null)
    setQueryDraft(null)
    setEnvHeaderDraft(null)
    setShowAdvanced(false)
    setProbeMsg('')
    setProbeOk(null)
    void refreshKeyStatus(draft.env_key)
  }

  const onProbe = async () => {
    if (!selectedModel) return
    setProbeBusy(true)
    setProbeMsg('')
    setProbeOk(null)
    try {
      const r = await probeModelEndpoint({
        baseUrl: selectedModel.base_url,
        extraHeaders: selectedModel.extra_headers,
        queryParams: selectedModel.query_params,
        envHttpHeaders: selectedModel.env_http_headers,
        envKey: selectedModel.env_key,
        apiKey: keyInput,
      })
      setProbeOk(r.ok)
      setProbeMsg(r.message)
    } catch (e) {
      setProbeOk(false)
      setProbeMsg(String(e))
    } finally {
      setProbeBusy(false)
    }
  }

  const removeSelectedModel = () => {
    if (models.length <= 1 || !selectedModelId) return
    const remaining = models.filter((m) => m.id !== selectedModelId)
    const nextId = remaining[0]?.id ?? ''
    setModels(remaining)
    setDraftModelIds((prev) => prev.filter((id) => id !== selectedModelId))
    if (defaultId === selectedModelId) setDefaultId(nextId)
    setSelectedModelId(nextId)
    setKeyInput('')
    setHeadersDraft(null)
    const next = remaining.find((m) => m.id === nextId)
    void refreshKeyStatus(next?.env_key || '')
  }

  const discardSelectedDraft = () => {
    if (!draftModelIds.includes(selectedModelId)) return
    removeSelectedModel()
  }

  const pickDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        defaultPath: settingsCwd || undefined,
      })
      if (typeof selected === 'string') setSettingsCwd(selected)
    } catch (e) {
      setToast({ message: String(e), type: 'error' })
    }
  }

  const onSave = async (): Promise<{ ok: boolean; error?: string }> => {
    setSavingSettings(true)
    setToast(null)
    try {
      if (!settingsCwd.trim()) throw new Error('请填写工作目录')
      const trimmed = prepareModelsForSave(models)
      // 选中即默认（与列表选择对齐）；若未选则用 defaultId
      const def = (selectedModelId || defaultId).trim()
      if (!def || !trimmed.some((m) => m.id === def)) {
        throw new Error('请选择一个有效的默认模型')
      }
      const selectedEntry =
        trimmed.find((m) => m.id === selectedModelId) ??
        trimmed.find((m) => m.id === def)

      const appliedCwd = await setWorkspaceCwd(settingsCwd.trim())
      if (keyInput.trim() && selectedEntry?.env_key.trim()) {
        await saveEnvKey(selectedEntry.env_key.trim(), keyInput.trim())
      }
      await saveModelSettings(def, trimmed)
      try {
        await reloadModels($activeTabId.get())
      } catch {
        /* 无会话可忽略 */
      }

      $models.set(trimmed)
      $defaultModelId.set(def)
      $preferredWorkspaceCwd.set(appliedCwd)
      patchActiveTab({ cwd: appliedCwd })
      setModels(trimmed)
      setDefaultId(def)
      setDraftModelIds([])
      setKeyInput('')

      const ent = trimmed.find((m) => m.id === def)
      const effort = ent?.supports_reasoning_effort
        ? ent.reasoning_effort || 'medium'
        : undefined
      try {
        await setCurrentModel($activeTabId.get(), def, effort)
        if (effort) $reasoningEffort.set(effort)
      } catch {
        /* 会话未就绪 */
      }

      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    } finally {
      setSavingSettings(false)
    }
  }

  const saveSecurity = async () => {
    setSavingSettings(true)
    setToast(null)
    try {
      const cwd = (settingsCwd || $workspaceCwd.get()).trim()
      const saved = policyFromDto(
        await setSecurityPolicy({
          execution_policy: execPolicy,
          internet_access: internetAccess,
          file_access: fileAccess,
          scope: policyScope,
          cwd,
        }),
      )
      $securityPolicy.set(saved)
      $sessionPolicyOverride.set(null)
      setPolicyScope(saved.scope)
      if (saved.executionPolicy === 'proceed-in-sandbox') {
        const tab = $activeTabId.get()
        if (tab && cwd) {
          try {
            const st = getTabState(tab)
            await restartSession(tab, cwd, {
              modelId: st?.modelId,
              reasoningEffort: st?.reasoningEffort,
            })
          } catch (e) {
            setToast({ message: `策略已保存，但沙箱启动失败：${String(e)}`, type: 'error' })
            return
          }
        }
      }
      setToast({ message: '安全策略已保存', type: 'success' })
      setTimeout(() => setToast(null), 1200)
    } catch (e) {
      setToast({ message: String(e), type: 'error' })
    } finally {
      setSavingSettings(false)
    }
  }

  const handleSave = async () => {
    setToast(null)
    const res = await onSave()
    if (res.ok) {
      setToast({ message: '配置模型成功', type: 'success' })
      setTimeout(() => {
        setToast(null)
        $settingsOpen.set(false)
      }, 600)
    } else if (res.error) {
      setToast({ message: res.error, type: 'error' })
    }
  }

  const onClose = () => {
    if (savingSettings) return
    $settingsOpen.set(false)
  }

  return (
    <div className="modal-backdrop settings-backdrop" onClick={onClose}>
      <div
        className="settings-shell"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {toast && (
          <div className={`settings-toast ${toast.type}`} role="alert">
            <span className="toast-icon">{toast.type === 'success' ? '✓' : '✕'}</span>
            <span className="toast-text">{toast.message}</span>
          </div>
        )}
        <div className="settings-shell-header">
          <div className="settings-shell-heading">
            <h2 id="settings-title">设置</h2>
            <p className="settings-shell-sub">工作区、模型与能力（对齐官方 config.toml）</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            <button
              type="button"
              className={`settings-nav-item${tab === 'general' ? ' active' : ''}`}
              onClick={() => setTab('general')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              通用
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'models' ? ' active' : ''}`}
              onClick={() => setTab('models')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              模型
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'security' ? ' active' : ''}`}
              onClick={() => setTab('security')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              安全
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'engine' ? ' active' : ''}`}
              onClick={() => setTab('engine')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
              </svg>
              引擎
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'hooks' ? ' active' : ''}`}
              onClick={() => setTab('hooks')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              Hooks
            </button>
            <div className="settings-nav-sep" aria-hidden />
            <button
              type="button"
              className={`settings-nav-item${tab === 'skills' ? ' active' : ''}`}
              onClick={() => setTab('skills')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              技能
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'tools' ? ' active' : ''}`}
              onClick={() => setTab('tools')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.7 6.3a1 1 0 0 0-1.4 0L8 11.6 12.4 16l5.3-5.3a1 1 0 0 0 0-1.4z" />
                <path d="m8 16-3 3" />
              </svg>
              工具
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'mcp' ? ' active' : ''}`}
              onClick={() => setTab('mcp')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="7" cy="12" r="3" />
                <circle cx="17" cy="12" r="3" />
                <path d="M10 12h4" />
              </svg>
              MCP
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'memory' ? ' active' : ''}`}
              onClick={() => setTab('memory')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="5" y="4" width="14" height="16" rx="2" />
                <path d="M9 8h6M9 12h6M9 16h4" />
              </svg>
              记忆
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'plugins' ? ' active' : ''}`}
              onClick={() => setTab('plugins')}
            >
              <svg className="settings-nav-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 7V4h6v3" />
                <path d="M8 7h8v6l-2 2v5h-4v-5l-2-2V7Z" />
              </svg>
              插件
            </button>
          </nav>

          <div className="settings-panel">
            {tab === 'general' && (
              <div className="settings-panel-inner">
                <section className="settings-card">
                  <h3 className="settings-card-title">工作目录</h3>
                  <p className="settings-card-desc">
                    Agent 读写文件、执行命令时使用的项目根路径。
                  </p>
                  {canSwitchWorkspace ? (
                    <>
                      <SettingsLabel htmlFor="settings-cwd" help="Agent 读写文件、跑命令时的项目根目录。">
                        路径
                      </SettingsLabel>
                      <div className="settings-row">
                        <input
                          id="settings-cwd"
                          type="text"
                          value={settingsCwd}
                          onChange={(e) => setSettingsCwd(e.target.value)}
                          className="settings-input"
                        />
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void pickDirectory()}
                        >
                          浏览…
                        </button>
                      </div>
                      <p className="settings-hint">
                        保存后写入本地配置；若会话已就绪会重建以切换目录。
                      </p>
                    </>
                  ) : (
                    <p className="settings-hint">
                      当前会话已有对话内容时不可在此切换工作区。请新建对话后再改，或使用输入框上方的工作区选择器（空会话时可用）。
                    </p>
                  )}
                </section>
              </div>
            )}

            {tab === 'engine' && (
              <EngineSettings
                saving={savingSettings}
                setSaving={setSavingSettings}
                bindSave={bindEngineSave}
                onToast={(message, type) => {
                  setToast({ message, type })
                  if (type === 'success') setTimeout(() => setToast(null), 1600)
                }}
              />
            )}

            {tab === 'hooks' && (
              <HooksSettings
                saving={savingSettings}
                setSaving={setSavingSettings}
                bindSave={bindHooksSave}
                onToast={(message, type) => {
                  setToast({ message, type })
                  if (type === 'success') setTimeout(() => setToast(null), 1600)
                }}
              />
            )}

            {tab === 'skills' && (
              <SettingsSessionGate>
                <SkillsPanel />
              </SettingsSessionGate>
            )}
            {tab === 'tools' && (
              <SettingsSessionGate>
                <ToolsPanel />
              </SettingsSessionGate>
            )}
            {tab === 'mcp' && (
              <SettingsSessionGate>
                <McpPanel />
              </SettingsSessionGate>
            )}
            {tab === 'memory' && (
              <SettingsSessionGate>
                <MemoryPanel />
              </SettingsSessionGate>
            )}
            {tab === 'plugins' && (
              <SettingsSessionGate>
                <PluginsPanel />
              </SettingsSessionGate>
            )}

            {tab === 'security' && (
              <div className="settings-panel-inner">
                <section className="settings-card">
                  <h3 className="settings-card-title">工具执行策略</h3>
                  <p className="settings-card-desc">
                    降低审批疲劳：白名单（git status、cargo check、lint 等）自动放行；
                    黑名单（rm -rf、format、管道下载执行等）自动拒绝。
                    「仅工作区」会拦截指向仓库外的读/写路径。其余按下方强度处理。
                  </p>
                  <SettingsLabel htmlFor="settings-exec-policy" help="模型要跑命令或改文件时，要不要先问你。审批=弹出确认；信任=除黑名单外直接跑；副本=改动写到 git 工作副本，不是系统沙箱。">
                    授权强度
                  </SettingsLabel>
                  <select
                    id="settings-exec-policy"
                    className="settings-input"
                    value={execPolicy}
                    onChange={(e) => setExecPolicy(e.target.value as ExecutionPolicy)}
                  >
                    <option value="request-review">审批模式（默认）— 未知命令弹出确认</option>
                    <option value="always-proceed">信任模式 — 除黑名单外全部自动放行</option>
                    <option value="proceed-in-sandbox">副本模式 — 文件写入 git worktree 副本（不是进程沙箱）</option>
                  </select>
                  <SettingsLabel htmlFor="settings-net" help="模型能不能访问互联网（搜索、下载、curl 等）。禁止时会拦截常见联网命令。">
                    联网
                  </SettingsLabel>
                  <select
                    id="settings-net"
                    className="settings-input"
                    value={internetAccess}
                    onChange={(e) => setInternetAccess(e.target.value as InternetAccess)}
                  >
                    <option value="ask">询问</option>
                    <option value="allow">允许</option>
                    <option value="deny">禁止（拦截 curl / wget 等）</option>
                  </select>
                  <SettingsLabel htmlFor="settings-files" help="模型能读改哪些路径。「仅工作区」会挡住指向仓库外面的读写。">
                    文件访问
                  </SettingsLabel>
                  <select
                    id="settings-files"
                    className="settings-input"
                    value={fileAccess}
                    onChange={(e) => setFileAccess(e.target.value as FileAccess)}
                  >
                    <option value="workspace-only">仅工作区</option>
                    <option value="unrestricted">不限制</option>
                  </select>
                  <SettingsLabel htmlFor="settings-policy-scope" help="这条策略是所有项目默认，还是只对当前工作区生效。">
                    生效范围
                  </SettingsLabel>
                  <select
                    id="settings-policy-scope"
                    className="settings-input"
                    value={policyScope}
                    onChange={(e) => setPolicyScope(e.target.value as 'global' | 'workspace')}
                  >
                    <option value="global">全局默认</option>
                    <option value="workspace">仅当前工作区（{settingsCwd || $workspaceCwd.get() || '未选择'}）</option>
                  </select>
                  <p className="settings-hint">
                    写入 `config.toml` 的 `[desktop]` 或 `[desktop.workspaces."…"]`。点下方保存即可生效。
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={savingSettings}
                    onClick={() => void saveSecurity()}
                  >
                    保存安全策略
                  </button>
                </section>
              </div>
            )}

            {tab === 'models' && (
              <div className="settings-models-layout">
                <div className="settings-models-list">
                  <div className="settings-models-list-header">
                    <span>已配置</span>
                    <button
                      type="button"
                      className="btn-inline"
                      disabled={savingSettings}
                      onClick={() => {
                        setHeadersDraft(null)
                        startAddModel('copy')
                      }}
                    >
                      + 拷贝当前
                    </button>
                  </div>
                  <div className="settings-vendor-row" aria-label="从模板新增">
                    {MODEL_VENDOR_TEMPLATES.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className="settings-vendor-chip"
                        disabled={savingSettings}
                        title={v.hint}
                        onClick={() => startAddModel(v.id)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>

                  {models.length === 0 ? (
                    <p className="settings-hint settings-models-empty">
                      尚无模型，点击「新增」。
                    </p>
                  ) : (
                    <ul className="settings-models-items">
                      {models.map((m) => {
                        const draft = draftModelIds.includes(m.id)
                        const active = m.id === selectedModelId
                        const title = m.model?.trim() || m.id
                        const host = hostFromBaseUrl(m.base_url)
                        const sub = host || m.api_backend || 'chat_completions'
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              className={`settings-model-item${active ? ' active' : ''}`}
                              onClick={() => onSelectModel(m.id)}
                            >
                              <span className="settings-model-item-name">
                                {draft ? (
                                  <span className="settings-badge-new">新</span>
                                ) : null}
                                {title}
                                {m.id === defaultId && !draft ? (
                                  <span className="settings-badge-default">默认</span>
                                ) : null}
                              </span>
                              <span className="settings-model-item-sub">{sub}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {modelConfigPath && (
                    <p
                      className="settings-hint settings-models-path"
                      title={modelConfigPath}
                    >
                      {modelConfigPath}
                    </p>
                  )}
                </div>

                <div className="settings-models-detail">
                  {!selectedModel ? (
                    <div className="settings-models-empty-detail">
                      <p className="settings-empty-title">选择或新增模型</p>
                      <p className="settings-hint">
                        左侧选一条，或用模板新增 OpenAI / Anthropic / Ollama 等。
                        写入官方 <code>[model.&lt;id&gt;]</code>。
                      </p>
                    </div>
                  ) : (
                    <div className="settings-models-detail-scroll">
                      <div className="settings-models-detail-header">
                        <div>
                          <h3 className="settings-panel-title">
                            {isDraft ? '新增模型' : '编辑模型'}
                          </h3>
                        </div>
                        <div className="settings-models-detail-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={savingSettings}
                            onClick={() => setDefaultId(selectedModel.id)}
                            title="设为默认模型"
                          >
                            {defaultId === selectedModel.id ? '已是默认' : '设为默认'}
                          </button>
                          {isDraft ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={savingSettings}
                              onClick={() => {
                                setHeadersDraft(null)
                                discardSelectedDraft()
                              }}
                            >
                              取消新增
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary btn-danger-outline"
                              disabled={savingSettings || models.length <= 1}
                              title={
                                models.length <= 1
                                  ? '至少保留一个模型'
                                  : '从列表删除（保存后写入配置）'
                              }
                              onClick={() => {
                                setHeadersDraft(null)
                                removeSelectedModel()
                              }}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>

                      {/* —— 连接 —— */}
                      <section className="settings-field-section">
                        <h4 className="settings-field-section-title">连接</h4>

                        <div className="settings-field">
                          <SettingsLabel help="发给对方接口的模型 id，不是本地昵称。例如 gpt-4o、claude-sonnet-4-6、llama3.1。">
                            模型名称
                          </SettingsLabel>
                          <input
                            type="text"
                            className="settings-input"
                            value={selectedModel.model}
                            placeholder="deepseek-v4-flash / claude-sonnet-4-6 / llama3.1:8b"
                            onChange={(e) =>
                              updateSelectedModel({
                                model: e.target.value,
                                name: e.target.value,
                              })
                            }
                          />
                          <p className="settings-hint">
                            发给对方的 model id，例如 gpt-4o、claude-sonnet-4-6、llama3.1。
                          </p>
                        </div>

                        <div className="settings-field">
                          <SettingsLabel help="对方 API 的根地址。OpenAI / Ollama / 多数兼容网关以 /v1 结尾；DeepSeek 官方是 https://api.deepseek.com，不要加 /v1。">
                            Base URL
                          </SettingsLabel>
                          <input
                            type="text"
                            className="settings-input"
                            value={selectedModel.base_url}
                            placeholder="https://api.deepseek.com"
                            onChange={(e) =>
                              updateSelectedModel({ base_url: e.target.value })
                            }
                          />
                          <p className="settings-hint">
                            OpenAI / Ollama / 多数网关以 <code>/v1</code> 结尾；DeepSeek
                            官方是 https://api.deepseek.com（不要加 /v1）。
                          </p>
                        </div>

                        <div className="settings-field">
                          <SettingsLabel help="请求用哪套协议。绝大多数第三方用 Chat Completions；Claude 官方用 Messages；部分新 OpenAI 兼容用 Responses。选错会 404 或解析失败。">
                            API 协议
                          </SettingsLabel>
                          <div className="settings-backend-options" role="radiogroup">
                            {API_BACKENDS.map((opt) => {
                              const active =
                                (selectedModel.api_backend || 'chat_completions') ===
                                opt.value
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  className={`settings-backend-card${active ? ' active' : ''}`}
                                  onClick={() =>
                                    updateSelectedModel({ api_backend: opt.value })
                                  }
                                >
                                  <span className="settings-backend-label">
                                    {opt.label}
                                  </span>
                                  <span className="settings-backend-hint">{opt.hint}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="settings-field-grid">
                          <div className="settings-field">
                            <SettingsLabel htmlFor="settings-context-k" help="一次对话最多塞多少千 token。到顶会触发压缩。请按厂商文档填，DeepSeek V4 可用 1000（约 100 万）。">
                              上下文窗口 (K)
                            </SettingsLabel>
                            <div className="settings-row">
                              <input
                                id="settings-context-k"
                                type="number"
                                min={1}
                                step={1}
                                className="settings-input"
                                value={
                                  selectedModel.context_window > 0
                                    ? Math.round(selectedModel.context_window / 1000)
                                    : ''
                                }
                                placeholder="128"
                                onChange={(e) => {
                                  const raw = e.target.value.trim()
                                  if (raw === '') {
                                    updateSelectedModel({ context_window: 0 })
                                    return
                                  }
                                  const k = Number(raw)
                                  if (!Number.isFinite(k) || k <= 0) {
                                    updateSelectedModel({ context_window: 0 })
                                    return
                                  }
                                  updateSelectedModel({
                                    context_window: Math.round(k) * 1000,
                                  })
                                }}
                              />
                              <span className="settings-unit">K tokens</span>
                            </div>
                            <p className="settings-hint">
                              按厂商文档填。DeepSeek V4 可用 1000（1M tokens）。
                            </p>
                          </div>
                          <div className="settings-field">
                            <SettingsLabel help="只给你自己看的备注，不会发给模型。">
                              描述（可选）
                            </SettingsLabel>
                            <input
                              type="text"
                              className="settings-input"
                              value={selectedModel.description || ''}
                              placeholder="简短说明"
                              onChange={(e) =>
                                updateSelectedModel({ description: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      </section>

                      {/* —— 推理 —— */}
                      <section className="settings-field-section">
                        <h4 className="settings-field-section-title">推理</h4>
                        <label className="settings-checkbox-label settings-reasoning-enable">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedModel.supports_reasoning_effort)}
                            onChange={(e) => {
                              const on = e.target.checked
                              updateSelectedModel({
                                supports_reasoning_effort: on,
                                reasoning_effort: on ? 'medium' : '',
                              })
                            }}
                          />
                          <span>
                            <strong>此模型支持推理 / 思考</strong>
                            <SettingsHelp text="只声明「这个模型会思考」。具体强度在对话输入栏切换模型时选，不在这里改。" />
                            <span className="settings-hint settings-hint-inline">
                              仅声明能力。强度在下方输入栏切换模型时选择。
                            </span>
                          </span>
                        </label>
                      </section>

                      {/* —— 密钥 —— */}
                      <section className="settings-field-section">
                        <h4 className="settings-field-section-title">密钥</h4>
                        <div className="settings-field">
                          <SettingsLabel help="密钥存在桌面 .env 里的变量名。同一家网关（如 OpenAI）多条模型选同一个名字，Key 只贴一次。Ollama 等本地服务可选「无需密钥」。">
                            共用哪把钥匙
                          </SettingsLabel>
                          <select
                            className="settings-input settings-select"
                            value={
                              selectedModel.env_key === ''
                                ? ''
                                : selectedModel.env_key || autoEnvKey(selectedModel.id)
                            }
                            onChange={(e) => {
                              const v = e.target.value
                              const next =
                                v === '__new__' ? autoEnvKey(selectedModel.id) : v
                              updateSelectedModel({ env_key: next })
                              setForceKeyEdit(false)
                              setKeyInput('')
                              void refreshKeyStatus(next)
                            }}
                          >
                            <option value="">无需密钥（Ollama 等）</option>
                            <option value="__new__">单独一把新钥匙</option>
                            {keyChoices.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                          <p className="settings-hint">
                            同一家第三方（如 OpenAI）多条模型选同一个名字，只贴一次 Key。
                          </p>
                        </div>
                        {selectedModel.env_key ? (
                          <div className="settings-key-block">
                            {keyStatus?.is_set && !forceKeyEdit ? (
                              <div className="settings-key-set-banner">
                                <span className="settings-key-set-text">已配置</span>
                                <span className="settings-hint">
                                  变量 {keyStatus.key_name} · 明文不在 config.toml
                                </span>
                                <button
                                  type="button"
                                  className="btn-inline"
                                  style={{ marginLeft: 'auto' }}
                                  onClick={() => setForceKeyEdit(true)}
                                >
                                  更新
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="settings-row">
                                  <input
                                    type={keyVisible ? 'text' : 'password'}
                                    value={keyInput}
                                    onChange={(e) => setKeyInput(e.target.value)}
                                    placeholder="粘贴 API Key"
                                    className="settings-input"
                                    autoComplete="off"
                                  />
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setKeyVisible((v) => !v)}
                                  >
                                    {keyVisible ? '隐藏' : '显示'}
                                  </button>
                                </div>
                                <p className="settings-hint">
                                  保存至 {envFilePath || '桌面 .env'}，不写入 config.toml。
                                </p>
                              </>
                            )}
                          </div>
                        ) : (
                          <p className="settings-hint">这条不发 Authorization 头。</p>
                        )}
                        <div className="settings-row" style={{ marginTop: '0.55rem' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={probeBusy || !selectedModel.base_url.trim()}
                            onClick={() => void onProbe()}
                          >
                            {probeBusy ? '探测中…' : '测连通'}
                          </button>
                          <SettingsHelp text="对 Base URL/models 发 GET，检查地址、协议和密钥对不对。未保存的粘贴 Key 也能测，不会写盘。" />
                          {probeMsg ? (
                            <span
                              className={`settings-probe-msg${probeOk ? ' is-ok' : ' is-bad'}`}
                            >
                              {probeMsg}
                            </span>
                          ) : (
                            <span className="settings-hint">
                              GET Base URL/models，用来确认地址和密钥。
                            </span>
                          )}
                        </div>
                      </section>

                      {/* —— 高级 —— */}
                      <section className="settings-field-section">
                        <button
                          type="button"
                          className="settings-advanced-toggle"
                          onClick={() => setShowAdvanced((v) => !v)}
                          aria-expanded={showAdvanced}
                        >
                          <span>高级选项</span>
                          <span className="settings-advanced-chevron">
                            {showAdvanced ? '▾' : '▸'}
                          </span>
                        </button>

                        {showAdvanced && (
                          <div className="settings-advanced-body">
                            <ModelSamplingFields
                              selectedModel={selectedModel}
                              updateSelectedModel={updateSelectedModel}
                            />

                            <div className="settings-field">
                              <SettingsLabel help="只用 API Key 鉴权时，请求可以走这个地址。空着就等于 Base URL。一般不用填。">
                                API 专用地址
                              </SettingsLabel>
                              <input
                                type="text"
                                className="settings-input"
                                value={selectedModel.api_base_url || ''}
                                placeholder="空 = 与 Base URL 相同；仅 API Key 鉴权时用此地址"
                                onChange={(e) =>
                                  updateSelectedModel({ api_base_url: e.target.value })
                                }
                              />
                            </div>

                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <SettingsLabel help="请求失败后自动再试几次。空着表示用默认。">
                                  最大重试次数
                                </SettingsLabel>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.max_retries > 0
                                      ? selectedModel.max_retries
                                      : ''
                                  }
                                  placeholder="默认"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({ max_retries: 0 })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      max_retries: Number.isFinite(n) && n > 0 ? n : 0,
                                    })
                                  }}
                                />
                              </div>
                              <div className="settings-field">
                                <SettingsLabel help="流式输出中断多久算超时（秒）。空着默认约 300 秒。">
                                  流式空闲超时秒
                                </SettingsLabel>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.inference_idle_timeout_secs > 0
                                      ? selectedModel.inference_idle_timeout_secs
                                      : ''
                                  }
                                  placeholder="默认 300"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({
                                        inference_idle_timeout_secs: 0,
                                      })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      inference_idle_timeout_secs:
                                        Number.isFinite(n) && n > 0 ? n : 0,
                                    })
                                  }}
                                />
                              </div>
                            </div>

                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <SettingsLabel help="工具参数是否一边生成一边往下传。有的网关要求关掉。空着表示不写进配置、用默认。">
                                  流式工具调用
                                </SettingsLabel>
                                <select
                                  className="settings-input settings-select"
                                  value={
                                    selectedModel.stream_tool_calls === null ||
                                    selectedModel.stream_tool_calls === undefined
                                      ? ''
                                      : selectedModel.stream_tool_calls
                                        ? 'true'
                                        : 'false'
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value
                                    updateSelectedModel({
                                      stream_tool_calls: v === '' ? null : v === 'true',
                                    })
                                  }}
                                >
                                  <option value="">默认（不写配置）</option>
                                  <option value="true">开启</option>
                                  <option value="false">关闭</option>
                                </select>
                              </div>
                              <div className="settings-field">
                                <SettingsLabel help="上下文用到百分之多少开始压缩旧对话。空着大约 85%。">
                                  自动压缩阈值 %
                                </SettingsLabel>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.auto_compact_threshold_percent > 0
                                      ? selectedModel.auto_compact_threshold_percent
                                      : ''
                                  }
                                  placeholder="默认约 85"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({
                                        auto_compact_threshold_percent: 0,
                                      })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      auto_compact_threshold_percent:
                                        Number.isFinite(n) && n > 0
                                          ? Math.min(100, n)
                                          : 0,
                                    })
                                  }}
                                />
                              </div>
                            </div>

                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <SettingsLabel help="官方智能体类型。一般保持 grok-build，除非你清楚在换另一套管线。">
                                  智能体类型
                                </SettingsLabel>
                                <input
                                  type="text"
                                  className="settings-input"
                                  value={selectedModel.agent_type || 'grok-build'}
                                  placeholder="grok-build"
                                  onChange={(e) =>
                                    updateSelectedModel({ agent_type: e.target.value })
                                  }
                                />
                              </div>
                              <div className="settings-field settings-field-checkbox">
                                <label className="settings-label settings-checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(selectedModel.use_concise)}
                                    onChange={(e) =>
                                      updateSelectedModel({
                                        use_concise: e.target.checked,
                                      })
                                    }
                                  />
                                  简洁模式
                                  <SettingsHelp text="让模型少说套话、回答更短。不是所有模型都吃这套提示。" />
                                </label>
                              </div>
                            </div>

                            <div className="settings-field">
                              <SettingsLabel help="每次请求都带上的固定 HTTP 头，例如 anthropic-version。不要把密钥写在这里。">
                                额外请求头
                              </SettingsLabel>
                              <textarea
                                className="settings-textarea"
                                rows={4}
                                value={headersValue}
                                placeholder={
                                  '每行一条：Header-Name: value\nanthropic-version: 2023-06-01'
                                }
                                onChange={(e) => {
                                  setHeadersDraft(e.target.value)
                                  updateSelectedModel({
                                    extra_headers: textToHeaders(e.target.value),
                                  })
                                }}
                                onBlur={() => setHeadersDraft(null)}
                              />
                              <p className="settings-hint">
                                静态头，例如 anthropic-version: 2023-06-01。密钥不要写在这里。
                              </p>
                            </div>

                            <div className="settings-field">
                              <SettingsLabel help="拼到每次请求 URL 后面的参数。Azure 的 api-version 写这里。不要把密钥放进查询串。">
                                查询参数
                              </SettingsLabel>
                              <textarea
                                className="settings-textarea"
                                rows={3}
                                value={queryValue}
                                placeholder="每行一条：api-version=2025-01-01-preview"
                                onChange={(e) => {
                                  setQueryDraft(e.target.value)
                                  updateSelectedModel({
                                    query_params: parseHeadersText(e.target.value),
                                  })
                                }}
                                onBlur={() => setQueryDraft(null)}
                              />
                              <p className="settings-hint">
                                官方字段，附加到每次请求 URL。Azure 的 api-version 写这里。
                              </p>
                            </div>

                            <div className="settings-field">
                              <SettingsLabel help="请求头的值从环境变量读，不写进 config.toml。左边是头名，右边是变量名，例如 x-api-key → ANTHROPIC_API_KEY。">
                                环境变量请求头
                              </SettingsLabel>
                              <textarea
                                className="settings-textarea"
                                rows={3}
                                value={envHeaderValue}
                                placeholder="每行：Header-Name: ENV_VAR_NAME"
                                onChange={(e) => {
                                  setEnvHeaderDraft(e.target.value)
                                  updateSelectedModel({
                                    env_http_headers: parseHeadersText(e.target.value),
                                  })
                                }}
                                onBlur={() => setEnvHeaderDraft(null)}
                              />
                              <p className="settings-hint">
                                头的值从环境变量读，不写进 config.toml。Anthropic 模板会填
                                x-api-key → ANTHROPIC_API_KEY。
                              </p>
                            </div>

                            <h5 className="settings-field-subtitle">可见性 (visibility)</h5>
                            <div className="settings-field-grid">
                              <label className="settings-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedModel.hidden)}
                                  onChange={(e) =>
                                    updateSelectedModel({ hidden: e.target.checked })
                                  }
                                />
                                隐藏模型
                                <SettingsHelp text="从对话输入栏的模型列表里藏起来。配置里还在，只是不拿出来选。" />
                              </label>
                              <label className="settings-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={selectedModel.supported_in_api !== false}
                                  onChange={(e) =>
                                    updateSelectedModel({
                                      supported_in_api: e.target.checked,
                                    })
                                  }
                                />
                                API Key 用户可见
                                <SettingsHelp text="只用 API Key、没有账号登录时，这条模型还出不出现在列表里。一般保持勾选。" />
                              </label>
                            </div>

                            <h5 className="settings-field-subtitle">
                              懒惰检测 (laziness_detector)
                            </h5>
                            <div className="settings-field-grid">
                              <label className="settings-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedModel.laziness_enabled)}
                                  onChange={(e) =>
                                    updateSelectedModel({
                                      laziness_enabled: e.target.checked,
                                    })
                                  }
                                />
                                启用检测
                                <SettingsHelp text="模型偷懒（空转、不干活）时是否提醒它继续。按官方 laziness_detector。" />
                              </label>
                              <div className="settings-field">
                                <SettingsLabel help="一轮对话里最多催几次。0 表示只观察、不提醒。">
                                  每会话最大提醒次数
                                </SettingsLabel>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.laziness_max_nudges > 0
                                      ? selectedModel.laziness_max_nudges
                                      : ''
                                  }
                                  placeholder="0 = 只观察不提醒"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({ laziness_max_nudges: 0 })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      laziness_max_nudges:
                                        Number.isFinite(n) && n > 0 ? n : 0,
                                    })
                                  }}
                                />
                              </div>
                            </div>

                            <h5 className="settings-field-subtitle">
                              压缩相关头 (compaction headers)
                            </h5>
                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <SettingsLabel help="告诉模型大概还剩几次上下文压缩。一般不用改。">
                                  剩余压缩次数
                                </SettingsLabel>
                                <select
                                  className="settings-input settings-select"
                                  value={selectedModel.compactions_remaining || ''}
                                  onChange={(e) =>
                                    updateSelectedModel({
                                      compactions_remaining: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">不设置</option>
                                  <option value="dynamic">动态</option>
                                  <option value="off">关闭</option>
                                  <option value="1">固定 1</option>
                                  <option value="0">固定 0</option>
                                </select>
                              </div>
                              <div className="settings-field">
                                <SettingsLabel help="告诉模型大概多少 token 会触发压缩。一般不用改。">
                                  压缩触发 Token
                                </SettingsLabel>
                                <select
                                  className="settings-input settings-select"
                                  value={
                                    ['', 'dynamic', 'off'].includes(
                                      selectedModel.compaction_at_tokens || '',
                                    )
                                      ? selectedModel.compaction_at_tokens || ''
                                      : 'custom'
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value
                                    if (v === 'custom') {
                                      updateSelectedModel({
                                        compaction_at_tokens: '100000',
                                      })
                                    } else {
                                      updateSelectedModel({ compaction_at_tokens: v })
                                    }
                                  }}
                                >
                                  <option value="">不设置</option>
                                  <option value="dynamic">按阈值动态</option>
                                  <option value="off">关闭</option>
                                  <option value="custom">固定 token 数…</option>
                                </select>
                                {selectedModel.compaction_at_tokens &&
                                  !['', 'dynamic', 'off'].includes(
                                    selectedModel.compaction_at_tokens,
                                  ) && (
                                    <input
                                      type="number"
                                      min={1}
                                      className="settings-input"
                                      style={{ marginTop: 8 }}
                                      value={selectedModel.compaction_at_tokens}
                                      onChange={(e) =>
                                        updateSelectedModel({
                                          compaction_at_tokens: e.target.value.replace(
                                            /\D/g,
                                            '',
                                          ),
                                        })
                                      }
                                    />
                                  )}
                              </div>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-shell-footer">
          <button
            type="button"
            className="btn-secondary"
            disabled={savingSettings}
            onClick={onClose}
          >
            {isCapability ? '关闭' : '取消'}
          </button>
          {isCapability ? null : (
          <button
            type="button"
            className="btn-primary"
            disabled={savingSettings}
            onClick={() => {
              if (tab === 'security') {
                void saveSecurity()
                return
              }
              if (tab === 'engine') {
                const fn = engineSaveRef.current
                if (!fn) {
                  setToast({ message: '引擎设置尚未就绪', type: 'error' })
                  return
                }
                void fn()
                return
              }
              if (tab === 'hooks') {
                const fn = hooksSaveRef.current
                if (!fn) {
                  setToast({ message: 'Hooks 设置尚未就绪', type: 'error' })
                  return
                }
                void fn()
                return
              }
              void handleSave()
            }}
          >
            {savingSettings ? '保存中…' : '保存'}
          </button>
          )}
        </div>
      </div>
    </div>
  )
}
