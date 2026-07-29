import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ComposerHandle } from '../components/Composer'
import {
  autoEnvKey,
  autoSystemPromptLabel,
  normalizeModelFromDisk,
  resolveEnvKey,
} from '../lib/models'
import { formatSessionTime } from '../lib/formatSessionTime'
import { isTauriRuntime } from '../lib/tauriEnv'
import {
  initialSessionShell,
  isEngineGenerating,
  isLoadingHistory,
  isShellBusy,
  isShellReady,
  selectCanSend,
  sessionShellReducer,
} from '../session/sessionLifecycle'
import { generateId, generateShortId } from '../lib/generateId'
import {
  isStreamDebugPreferred,
  setStreamDebugPreferred,
} from '../lib/streamMetrics'
import { emptyModelEntry, type ModelEntry, type ModelSettings, type RecentChat, type SessionEvent } from '../types'
import type { ToastItem } from '../components/Toast'
import { useChatMessages } from './useChatMessages'

/**
 * 桌面端主逻辑（会话 / 模型 / 工作区 / 设置）。
 * 会话壳层：sessionShellReducer（phase 状态机），不再用 ready×starting×loading 拼凑。
 */
export function useDesktopApp() {
  const inTauri = isTauriRuntime()

  // ── 布局 ──────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [recentChats, setRecentChats] = useState<RecentChat[]>([])
  const [workspaceCwd, setWorkspaceCwd] = useState('')

  const workspaceOptions = useMemo(() => {
    const seen = new Map<string, string>()
    const add = (cwd?: string) => {
      const c = (cwd || '').trim()
      if (!c) return
      const key = c.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (!seen.has(key)) seen.set(key, c)
    }
    add(workspaceCwd)
    recentChats.forEach((c) => add(c.cwd))
    return Array.from(seen.values())
  }, [workspaceCwd, recentChats])

  // ── 会话壳层状态机 ────────────────────────────────────
  const [sessionShell, dispatchSession] = useReducer(
    sessionShellReducer,
    initialSessionShell,
  )
  const { phase: sessionPhase, engineStatus, activeSessionId: activeChatId } =
    sessionShell
  const shellReady = isShellReady(sessionPhase)
  const shellBusy = isShellBusy(sessionPhase)
  const loadingHistory = isLoadingHistory(sessionPhase)
  const engineGenerating = isEngineGenerating(engineStatus)
  /** 壳层不忙时才允许 start / restart / load */
  const canMutateShell = !shellBusy

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const chat = useChatMessages()
  const {
    messages,
    setMessages,
    contextUsedTokens,
    setContextUsedTokens,
    usageDetail,
    usageDetailLoading,
    fetchUsageDetail,
    setPermissionQueue,
    permission,
    pushMessage,
    stream,
    pendingPrompts,
    upsertToolCall,
    patchToolCall,
    resetConversationUi,
  } = chat

  const canSwitchWorkspace =
    shellReady && !messages.some((m) => m.role === 'user')

  // ── 设置 / 模型 ───────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCwd, setSettingsCwd] = useState('')
  const [keyStatus, setKeyStatus] = useState<{ key_name: string; is_set: boolean } | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [modelConfigPath, setModelConfigPath] = useState('')
  const [envFilePath, setEnvFilePath] = useState('')
  const [draftModelIds, setDraftModelIds] = useState<string[]>([])
  const [reasoningEffort, setReasoningEffort] = useState('medium')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [streamDebugOpen, setStreamDebugOpen] = useState(() => isStreamDebugPreferred())

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = generateId('toast_')
    setToasts((prev) => [...prev.slice(-4), { id, message, tone }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toggleStreamDebug = useCallback(() => {
    setStreamDebugOpen((v) => {
      const next = !v
      setStreamDebugPreferred(next)
      return next
    })
  }, [])

  const composerRef = useRef<ComposerHandle>(null)
  const autoStarted = useRef(false)
  /** 事件监听闭包用：避免依赖 session 状态导致频繁重订阅 */
  const loadingHistoryRef = useRef(loadingHistory)
  const engineGeneratingRef = useRef(engineGenerating)
  useEffect(() => {
    loadingHistoryRef.current = loadingHistory
  }, [loadingHistory])
  useEffect(() => {
    engineGeneratingRef.current = engineGenerating
  }, [engineGenerating])

  // ── session-event 订阅 ────────────────────────────────
  useEffect(() => {
    if (!inTauri) return

    let unlisten: UnlistenFn | undefined
    let cancelled = false

    ;(async () => {
      unlisten = await listen<SessionEvent>('session-event', (event) => {
        const payload = event.payload
        // 历史加载 / 非生成态：文本立即落地，不走 rAF 打字机
        const immediateText =
          loadingHistoryRef.current || !engineGeneratingRef.current
        switch (payload.type) {
          case 'agent_text_chunk':
            pushMessage('assistant', payload.text, true, undefined, immediateText)
            break
          case 'agent_thought_chunk':
            pushMessage('thought', payload.text, true, undefined, immediateText)
            break
          case 'user_text_chunk': {
            const pid = payload.prompt_id
            if (pid && pendingPrompts.has(pid)) break
            if (stream.getActiveRole() === 'user') {
              pushMessage('user', payload.text, true, undefined, immediateText)
            } else {
              pushMessage('user', payload.text)
            }
            break
          }
          case 'tool_call':
            upsertToolCall(payload.tool)
            break
          case 'tool_call_update':
            patchToolCall(payload.update)
            break
          case 'token_usage':
            setContextUsedTokens(payload.total_tokens)
            break
          case 'turn_ended': {
            if (payload.prompt_id) pendingPrompts.clear(payload.prompt_id)
            stream.seal()
            break
          }
          case 'error': {
            if (payload.prompt_id) pendingPrompts.clear(payload.prompt_id)
            stream.seal()
            setError(payload.message)
            pushMessage('system', `错误: ${payload.message}`)
            break
          }
          case 'other':
            break
          case 'permission_request':
            setPermissionQueue((prev) => [
              ...prev,
              {
                request_id: payload.request_id,
                description: payload.description,
                options: payload.options,
              },
            ])
            break
          case 'status_changed':
            dispatchSession({ type: 'ENGINE_STATUS', status: payload.status })
            break
          case 'session_id_changed':
            dispatchSession({ type: 'SESSION_ID', sessionId: payload.session_id })
            break
        }
      })
      if (cancelled) unlisten?.()
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [
    inTauri,
    pushMessage,
    upsertToolCall,
    patchToolCall,
    stream,
    pendingPrompts,
    setContextUsedTokens,
    setPermissionQueue,
  ])

  const refreshSessionList = useCallback(async () => {
    try {
      const cwd = await invoke<string>('workspace_cwd')
      setWorkspaceCwd(cwd)
      const sessions = await invoke<
        {
          id: string
          title: string
          updated_at: string
          num_messages: number
          cwd: string
        }[]
      >('list_sessions', { cwd, limit: 80 })
      setRecentChats(
        sessions.map((s) => ({
          id: s.id,
          title: s.title || '新对话',
          timestamp: formatSessionTime(s.updated_at),
          rawTimestamp: s.updated_at,
          cwd: s.cwd || cwd,
        })),
      )
    } catch (e) {
      console.error('刷新会话列表失败', e)
    }
  }, [])

  const loadModelsFromDisk = useCallback(async (): Promise<string> => {
    if (!inTauri) return ''
    try {
      const modelSettings = await invoke<ModelSettings>('get_model_settings')
      const normalized = modelSettings.models.map(normalizeModelFromDisk)
      setModels(normalized)
      setModelConfigPath(modelSettings.config_path)
      const pick =
        modelSettings.default_id &&
        normalized.some((m) => m.id === modelSettings.default_id)
          ? modelSettings.default_id
          : (normalized[0]?.id ?? '')
      let resolved = pick
      if (pick) {
        setSelectedModelId((prev) => {
          const next = normalized.some((m) => m.id === prev) ? prev : pick
          resolved = next
          return next
        })
      }
      return resolved
    } catch (e) {
      console.error('加载模型列表失败', e)
      return ''
    }
  }, [inTauri])

  const syncSessionModel = useCallback(
    async (modelId: string, effortOverride?: string) => {
      const id = modelId.trim()
      if (!id) return
      const entry = models.find((m) => m.id === id)
      const effort = entry?.supports_reasoning_effort
        ? effortOverride || entry.reasoning_effort || reasoningEffort || 'medium'
        : undefined
      try {
        await invoke('set_current_model', {
          modelId: id,
          reasoningEffort: effort ?? null,
        })
        setSelectedModelId(id)
        if (effort) setReasoningEffort(effort)
      } catch (e) {
        console.warn('同步会话模型失败', e)
      }
    },
    [models, reasoningEffort],
  )

  const startSession = useCallback(async () => {
    if (!inTauri || !canMutateShell) return
    dispatchSession({ type: 'BOOT_START' })
    setError(null)
    try {
      const modelId = await loadModelsFromDisk()
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('start_session', { cwd })
      dispatchSession({ type: 'BOOT_OK' })
      await syncSessionModel(modelId)
      void refreshSessionList()
    } catch (e) {
      dispatchSession({ type: 'BOOT_FAIL' })
      setError(String(e))
    }
  }, [inTauri, canMutateShell, refreshSessionList, loadModelsFromDisk, syncSessionModel])

  const restartSession = useCallback(async () => {
    if (!inTauri || !canMutateShell) return
    const hadUserMessage = messages.some((m) => m.role === 'user')
    const prevId = activeChatId
    const modelToUse = selectedModelId

    resetConversationUi()
    setError(null)
    setInput('')
    dispatchSession({ type: 'RESTART_START' })

    if (!hadUserMessage && prevId) {
      setRecentChats((prev) => prev.filter((c) => c.id !== prevId))
    }

    try {
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('restart_session', { cwd })
      dispatchSession({ type: 'RESTART_OK' })
      const id = modelToUse.trim() || (await loadModelsFromDisk())
      await syncSessionModel(id)
      void refreshSessionList()
    } catch (e) {
      dispatchSession({ type: 'RESTART_FAIL' })
      const msg = String(e)
      setError(msg)
      pushMessage('system', `出了点问题: ${msg}`)
    }
  }, [
    inTauri,
    canMutateShell,
    messages,
    activeChatId,
    selectedModelId,
    pushMessage,
    refreshSessionList,
    loadModelsFromDisk,
    syncSessionModel,
    resetConversationUi,
  ])

  useEffect(() => {
    if (!inTauri) return
    if (autoStarted.current) return
    autoStarted.current = true
    void startSession()
  }, [inTauri, startSession])

  const handleNewChat = useCallback(() => {
    if (!canMutateShell) return
    void restartSession()
  }, [restartSession, canMutateShell])

  const handleSelectChat = useCallback(
    async (id: string, sessionCwd?: string) => {
      if (!inTauri || !canMutateShell) return
      if (id === activeChatId && shellReady) return

      const hadUserMessage = messages.some((m) => m.role === 'user')
      const prevId = activeChatId
      const fromList = recentChats.find((c) => c.id === id)

      resetConversationUi()
      setError(null)
      dispatchSession({ type: 'LOAD_START', sessionId: id })

      if (!hadUserMessage && prevId && prevId !== id) {
        setRecentChats((prev) => prev.filter((c) => c.id !== prevId))
      }

      try {
        const fallbackCwd = await invoke<string>('workspace_cwd')
        const cwd = (sessionCwd || fromList?.cwd || fallbackCwd).trim() || fallbackCwd
        await invoke('load_session', { sessionId: id, cwd })
        dispatchSession({ type: 'LOAD_OK' })
        // 历史回放可能仍在 drain；稍后 flush 打字机，避免末条 AI 卡在 pending
        window.setTimeout(() => stream.flush(), 0)
        window.setTimeout(() => stream.flush(), 80)
        try {
          const appliedCwd = await invoke<string>('set_workspace_cwd', { cwd })
          setWorkspaceCwd(appliedCwd)
          setSettingsCwd(appliedCwd)
        } catch (e) {
          console.warn('持久化跨工作区 cwd 失败', e)
          setWorkspaceCwd(cwd)
          setSettingsCwd(cwd)
        }

        const modelId = selectedModelId.trim() || (await loadModelsFromDisk())
        await syncSessionModel(modelId)
      } catch (e) {
        const msg = String(e)
        setError(msg)
        pushMessage('system', `恢复会话失败: ${msg}`)
        dispatchSession({ type: 'LOAD_FAIL', restoreSessionId: prevId })
      }
    },
    [
      inTauri,
      canMutateShell,
      activeChatId,
      shellReady,
      messages,
      recentChats,
      selectedModelId,
      pushMessage,
      loadModelsFromDisk,
      syncSessionModel,
      resetConversationUi,
      stream,
    ],
  )

  const refreshKeyStatus = useCallback(async (envKey: string) => {
    const name = envKey.trim()
    if (!name) {
      setKeyStatus(null)
      return
    }
    try {
      const status = await invoke<{ key_name: string; is_set: boolean }>('get_env_status', {
        keyName: name,
      })
      setKeyStatus(status)
    } catch {
      setKeyStatus({ key_name: name, is_set: false })
    }
  }, [])

  const openSettings = useCallback(async () => {
    if (!inTauri) return
    try {
      const cwd = await invoke<string>('workspace_cwd')
      setSettingsCwd(cwd)
      setKeyInput('')
      setKeyVisible(false)
      const modelSettings = await invoke<ModelSettings>('get_model_settings')
      setModelConfigPath(modelSettings.config_path)
      try {
        const loc = await invoke<string>('env_file_location')
        setEnvFilePath(loc)
      } catch {
        setEnvFilePath('')
      }
      setDraftModelIds([])
      const normalized = modelSettings.models.map(normalizeModelFromDisk)
      setModels(normalized)
      const pick =
        modelSettings.default_id &&
        normalized.some((m) => m.id === modelSettings.default_id)
          ? modelSettings.default_id
          : (normalized[0]?.id ?? '')
      setSelectedModelId(pick)
      const envKey = normalized.find((m) => m.id === pick)?.env_key || ''
      await refreshKeyStatus(envKey)
      setSettingsOpen(true)
    } catch (e) {
      setError(String(e))
    }
  }, [inTauri, refreshKeyStatus])

  const pickDirectory = useCallback(async () => {
    const selected = await openDialog({ directory: true, defaultPath: settingsCwd || undefined })
    if (typeof selected === 'string') {
      setSettingsCwd(selected)
    }
  }, [settingsCwd])

  const selectModel = useCallback(
    (id: string) => {
      setSelectedModelId(id)
      setKeyInput('')
      setKeyVisible(false)
      const entry = models.find((m) => m.id === id)
      void refreshKeyStatus(entry ? resolveEnvKey(entry) : '')
    },
    [models, refreshKeyStatus],
  )

  const switchCurrentModel = useCallback(
    async (modelId: string) => {
      if (!inTauri || !shellReady) return
      const entry = models.find((m) => m.id === modelId)
      const effort = entry?.supports_reasoning_effort
        ? entry.reasoning_effort || reasoningEffort || 'medium'
        : undefined
      try {
        await invoke('set_current_model', {
          modelId,
          reasoningEffort: effort ?? null,
        })
        setSelectedModelId(modelId)
        if (effort) setReasoningEffort(effort)
        const label = entry?.model || modelId
        pushToast(`已切换模型 · ${label}`, 'success')
      } catch (e) {
        setError(String(e))
      }
    },
    [inTauri, shellReady, models, pushToast, reasoningEffort],
  )

  const switchReasoningEffort = useCallback(
    async (effort: string) => {
      if (!inTauri || !shellReady || !selectedModelId) return
      const entry = models.find((m) => m.id === selectedModelId)
      if (!entry?.supports_reasoning_effort) return
      try {
        await invoke('set_current_model', {
          modelId: selectedModelId,
          reasoningEffort: effort,
        })
        setReasoningEffort(effort)
      } catch (e) {
        setError(String(e))
      }
    },
    [inTauri, shellReady, selectedModelId, models],
  )

  const applyWorkspaceCwd = useCallback(
    async (nextCwd: string) => {
      const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (norm(nextCwd) === norm(workspaceCwd)) return
      try {
        const appliedCwd = await invoke<string>('set_workspace_cwd', { cwd: nextCwd })
        setWorkspaceCwd(appliedCwd)
        setSettingsCwd(appliedCwd)
        if (shellReady) {
          if (!canMutateShell) return
          resetConversationUi()
          dispatchSession({ type: 'RESTART_START' })
          try {
            await invoke('restart_session', { cwd: appliedCwd })
            dispatchSession({ type: 'RESTART_OK' })
            await syncSessionModel(selectedModelId)
            pushMessage('system', `工作目录已切换 · ${appliedCwd}`)
          } catch (e) {
            dispatchSession({ type: 'RESTART_FAIL' })
            throw e
          }
          void refreshSessionList()
        } else {
          void refreshSessionList()
          pushMessage('system', `工作目录已保存 · ${appliedCwd}（下次新对话生效）`)
        }
      } catch (e) {
        setError(String(e))
      }
    },
    [
      workspaceCwd,
      shellReady,
      canMutateShell,
      selectedModelId,
      syncSessionModel,
      pushMessage,
      refreshSessionList,
      resetConversationUi,
    ],
  )

  const browseWorkspace = useCallback(async () => {
    const selected = await openDialog({ directory: true, defaultPath: workspaceCwd || undefined })
    if (typeof selected === 'string' && selected.trim()) {
      await applyWorkspaceCwd(selected.trim())
    }
  }, [workspaceCwd, applyWorkspaceCwd])

  const updateSelectedModel = useCallback(
    (patch: Partial<ModelEntry>) => {
      setModels((prev) =>
        prev.map((m) => (m.id === selectedModelId ? { ...m, ...patch } : m)),
      )
    },
    [selectedModelId],
  )

  const startAddModel = useCallback(() => {
    const existing = new Set(models.map((m) => m.id))
    let id = ''
    for (let i = 0; i < 24; i++) {
      const candidate = `m-${generateShortId(12)}`
      if (!existing.has(candidate)) {
        id = candidate
        break
      }
    }
    if (!id) id = `m-${generateShortId(12)}`
    const template = models.find((m) => m.id === selectedModelId) ?? models[0]
    const envKey = autoEnvKey(id)
    const draft = emptyModelEntry({
      id,
      name: '',
      model: '',
      base_url: template?.base_url ?? '',
      env_key: envKey,
      context_window: 0,
      system_prompt_label: '',
      api_backend: template?.api_backend || 'chat_completions',
      description: '',
      temperature: null,
      top_p: null,
      max_completion_tokens: null,
      extra_headers: {},
      api_base_url: '',
      max_retries: 0,
      inference_idle_timeout_secs: 0,
      stream_tool_calls: null,
      agent_type: template?.agent_type || 'grok-build',
      use_concise: false,
      auto_compact_threshold_percent: 0,
      supports_reasoning_effort: false,
      reasoning_effort: 'medium',
      hidden: false,
      supported_in_api: true,
      laziness_enabled: false,
      laziness_max_nudges: 0,
      compactions_remaining: '',
      compaction_at_tokens: '',
    })
    setModels((prev) => [...prev, draft])
    setDraftModelIds((prev) => [...prev, id])
    setSelectedModelId(id)
    setKeyInput('')
    setKeyVisible(false)
    void refreshKeyStatus(envKey)
  }, [models, selectedModelId, refreshKeyStatus])

  const discardSelectedDraft = useCallback(() => {
    if (!draftModelIds.includes(selectedModelId)) return
    const remaining = models.filter((m) => m.id !== selectedModelId)
    const nextId = remaining[0]?.id ?? ''
    setModels(remaining)
    setDraftModelIds((prev) => prev.filter((id) => id !== selectedModelId))
    setSelectedModelId(nextId)
    setKeyInput('')
    setKeyVisible(false)
    const next = remaining.find((m) => m.id === nextId)
    void refreshKeyStatus(next ? resolveEnvKey(next) : '')
  }, [draftModelIds, selectedModelId, models, refreshKeyStatus])

  const removeSelectedModel = useCallback(() => {
    if (models.length <= 1) {
      setError('至少保留一个模型')
      return
    }
    const remaining = models.filter((m) => m.id !== selectedModelId)
    const nextId = remaining[0]?.id ?? ''
    setModels(remaining)
    setDraftModelIds((prev) => prev.filter((id) => id !== selectedModelId))
    setSelectedModelId(nextId)
    setKeyInput('')
    setKeyVisible(false)
    const next = remaining.find((m) => m.id === nextId)
    void refreshKeyStatus(next ? resolveEnvKey(next) : '')
  }, [models, selectedModelId, refreshKeyStatus])

  const saveSettings = useCallback(async () => {
    setSavingSettings(true)
    try {
      if (models.length === 0) {
        throw new Error('至少需要配置一个模型')
      }

      const prevCwd = (await invoke<string>('workspace_cwd')).trim()
      const nextCwdRaw = settingsCwd.trim()
      if (!nextCwdRaw) {
        throw new Error('请填写工作目录')
      }
      let appliedCwd = prevCwd
      let cwdChanged = false
      const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (norm(nextCwdRaw) !== norm(prevCwd)) {
        appliedCwd = await invoke<string>('set_workspace_cwd', { cwd: nextCwdRaw })
        setSettingsCwd(appliedCwd)
        setWorkspaceCwd(appliedCwd)
        cwdChanged = true
      }

      const trimmedModels = models.map((m) => {
        const model = m.model.trim()
        const id = m.id.trim()
        if (!(m.context_window > 0)) {
          throw new Error(
            `模型「${model || id || '未命名'}」请填写上下文窗口 (K)，例如 128、256、1000`,
          )
        }
        const backend = (m.api_backend || 'chat_completions').trim() || 'chat_completions'
        if (!['chat_completions', 'responses', 'messages'].includes(backend)) {
          throw new Error(`模型「${model || id}」api_backend 无效`)
        }
        return emptyModelEntry({
          ...m,
          id,
          env_key: resolveEnvKey({ id, env_key: m.env_key }),
          base_url: m.base_url.trim(),
          model,
          name: model,
          description: (m.description || '').trim(),
          system_prompt_label: autoSystemPromptLabel(model),
          context_window: m.context_window,
          api_backend: backend,
          temperature: m.temperature,
          top_p: m.top_p,
          max_completion_tokens: m.max_completion_tokens,
          extra_headers: m.extra_headers || {},
          api_base_url: (m.api_base_url || '').trim(),
          max_retries: m.max_retries > 0 ? m.max_retries : 0,
          inference_idle_timeout_secs:
            m.inference_idle_timeout_secs > 0 ? m.inference_idle_timeout_secs : 0,
          stream_tool_calls:
            m.stream_tool_calls === undefined ? null : m.stream_tool_calls,
          agent_type: (m.agent_type || 'grok-build').trim() || 'grok-build',
          use_concise: Boolean(m.use_concise),
          auto_compact_threshold_percent:
            m.auto_compact_threshold_percent > 0
              ? Math.min(100, m.auto_compact_threshold_percent)
              : 0,
          supports_reasoning_effort: Boolean(m.supports_reasoning_effort),
          reasoning_effort: m.supports_reasoning_effort
            ? (m.reasoning_effort || 'medium').trim() || 'medium'
            : '',
          hidden: Boolean(m.hidden),
          supported_in_api: m.supported_in_api !== false,
          laziness_enabled: Boolean(m.laziness_enabled),
          laziness_max_nudges: m.laziness_max_nudges > 0 ? m.laziness_max_nudges : 0,
          compactions_remaining: (m.compactions_remaining || '').trim(),
          compaction_at_tokens: (m.compaction_at_tokens || '').trim(),
        })
      })
      const selected = trimmedModels.find((m) => m.id === selectedModelId)
      if (keyInput.trim().length > 0) {
        const envKeyName = selected?.env_key || ''
        if (!envKeyName) {
          throw new Error('无法生成密钥存储名，请重试')
        }
        await invoke('save_env_key', {
          keyName: envKeyName,
          value: keyInput.trim(),
        })
      }
      const defaultId = selectedModelId.trim()
      if (!defaultId || !trimmedModels.some((m) => m.id === defaultId)) {
        throw new Error('请选择一个有效的默认模型')
      }
      await invoke('save_model_settings', {
        defaultId,
        models: trimmedModels,
      })
      await invoke('reload_models')

      setModels(trimmedModels)
      setSelectedModelId(defaultId)
      setDraftModelIds([])
      setError(null)

      const entry = trimmedModels.find((m) => m.id === defaultId)
      const modelLabel = entry?.model || defaultId || '默认'

      if (cwdChanged && shellReady) {
        resetConversationUi()
        dispatchSession({ type: 'RESTART_START' })
        try {
          await invoke('restart_session', { cwd: appliedCwd })
          dispatchSession({ type: 'RESTART_OK' })
          await syncSessionModel(defaultId)
          pushMessage('system', `工作目录已切换 · ${appliedCwd}`)
        } catch (e) {
          dispatchSession({ type: 'RESTART_FAIL' })
          throw e
        }
        void refreshSessionList()
      } else {
        if (shellReady) {
          try {
            const ent = trimmedModels.find((m) => m.id === defaultId)
            await invoke('set_current_model', {
              modelId: defaultId,
              reasoningEffort: ent?.supports_reasoning_effort
                ? ent.reasoning_effort || 'medium'
                : null,
            })
            if (ent?.supports_reasoning_effort) {
              setReasoningEffort(ent.reasoning_effort || 'medium')
            }
          } catch (e) {
            console.warn('保存后切换会话模型失败', e)
          }
        }
        if (cwdChanged) {
          setWorkspaceCwd(appliedCwd)
          void refreshSessionList()
          pushMessage('system', `工作目录已保存 · ${appliedCwd}（下次新对话生效）`)
        } else {
          pushMessage('system', `模型配置已保存 · 当前使用 ${modelLabel}（未中断对话）`)
        }
      }

      return { ok: true as const }
    } catch (e) {
      const msg = String(e)
      setError(msg)
      return { ok: false as const, error: msg }
    } finally {
      setSavingSettings(false)
    }
  }, [
    keyInput,
    pushMessage,
    models,
    selectedModelId,
    shellReady,
    settingsCwd,
    syncSessionModel,
    refreshSessionList,
    resetConversationUi,
  ])

  const onSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || !selectCanSend(inTauri, sessionShell)) return
    setInput('')
    setError(null)
    // 发送前清掉未吐完的缓冲，避免旧流式残留
    stream.discard()
    stream.setActiveRole(null)
    const isFirstUserMessage = !messages.some((m) => m.role === 'user')
    if (isFirstUserMessage) {
      const title = text.replace(/\s+/g, ' ')
      setRecentChats((prev) => {
        const exists = prev.some((c) => c.id === activeChatId)
        if (exists) {
          return prev.map((c) => (c.id === activeChatId ? { ...c, title } : c))
        }
        return [
          {
            id: activeChatId,
            title,
            timestamp: '刚刚',
            rawTimestamp: new Date().toISOString(),
            cwd: workspaceCwd || undefined,
          },
          ...prev,
        ]
      })
    }
    const promptId = generateId('prompt_')
    pushMessage('user', text, false, promptId)
    // 用户气泡已完整落盘，不进入流式 append 态
    stream.setActiveRole(null)
    pendingPrompts.track(promptId)

    try {
      await invoke('send_prompt', { text, promptId })
    } catch (e) {
      pendingPrompts.clear(promptId)
      setMessages((prev) => prev.filter((m) => m.promptId !== promptId))
      setInput(text)
      const msg = String(e)
      setError(msg)
      pushMessage('system', `发送失败: ${msg}`)
    }
  }

  const onCancel = async () => {
    try {
      stream.flush()
      await invoke('cancel_turn')
    } catch (e) {
      setError(String(e))
    }
  }

  const onPermission = async (optionId: string) => {
    if (!permission) return
    const { request_id } = permission
    setPermissionQueue((prev) => prev.slice(1))
    try {
      await invoke('respond_permission', {
        requestId: request_id,
        optionId,
      })
      setTimeout(() => composerRef.current?.focus(), 0)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDeleteChat = useCallback(
    async (id: string, sessionCwd?: string) => {
      if (!inTauri || !canMutateShell) return
      const deletingActive = id === activeChatId
      const fromList = recentChats.find((c) => c.id === id)

      setRecentChats((prev) => prev.filter((c) => c.id !== id))

      if (deletingActive) {
        resetConversationUi()
        setError(null)
        dispatchSession({ type: 'RESTART_START' })
      }

      try {
        const fallbackCwd = await invoke<string>('workspace_cwd')
        const cwd = (sessionCwd || fromList?.cwd || fallbackCwd).trim() || fallbackCwd
        await invoke('delete_session', { sessionId: id, cwd })
        if (deletingActive) {
          dispatchSession({ type: 'RESTART_OK' })
        }
        void refreshSessionList()
      } catch (e) {
        const msg = String(e)
        setError(`删除会话失败: ${msg}`)
        if (deletingActive) {
          dispatchSession({ type: 'RESTART_FAIL' })
        }
        void refreshSessionList()
      }
    },
    [
      inTauri,
      canMutateShell,
      activeChatId,
      recentChats,
      refreshSessionList,
      resetConversationUi,
    ],
  )

  const handleRenameChat = useCallback(
    async (id: string, title: string, sessionCwd?: string) => {
      if (!inTauri) {
        throw new Error('请在桌面应用中操作')
      }
      const next = title.trim()
      if (!next) {
        throw new Error('标题不能为空')
      }
      const fromList = recentChats.find((c) => c.id === id)
      const fallbackCwd = await invoke<string>('workspace_cwd')
      const cwd = (sessionCwd || fromList?.cwd || fallbackCwd).trim() || fallbackCwd
      await invoke('rename_session', {
        sessionId: id,
        cwd,
        title: next,
      })
      setRecentChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: next } : c)),
      )
      void refreshSessionList()
    },
    [inTauri, recentChats, refreshSessionList],
  )

  const canSend = selectCanSend(inTauri, sessionShell)

  // 快捷键：Ctrl/Cmd+N 新建；Ctrl/Cmd+K/, 设置；Ctrl+Shift+D 流式性能浮层
  useEffect(() => {
    if (!inTauri) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        toggleStreamDebug()
        return
      }
      if (mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        if (canMutateShell) void restartSession()
        return
      }
      if (mod && (e.key === ',' || e.key === 'k' || e.key === 'K')) {
        if (e.key === 'k' || e.key === 'K' || e.key === ',') {
          e.preventDefault()
          void openSettings()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inTauri, canMutateShell, restartSession, openSettings, toggleStreamDebug])

  const chatTitle = useMemo(() => {
    const fromList = recentChats.find((c) => c.id === activeChatId)?.title?.trim()
    if (fromList && fromList !== '新对话') return fromList
    const firstUser = messages.find((m) => m.role === 'user' && m.text.trim())
    if (firstUser) {
      return firstUser.text.trim().replace(/\s+/g, ' ')
    }
    return fromList || '新对话'
  }, [messages, recentChats, activeChatId])

  return {
    inTauri,
    sidebarCollapsed,
    setSidebarCollapsed,
    recentChats,
    workspaceCwd,
    workspaceOptions,
    activeChatId,
    /** 壳层阶段：idle | booting | ready | restarting | loading | failed */
    sessionPhase,
    /** 后端 ACP 引擎状态 */
    engineStatus,
    shellReady,
    shellBusy,
    loadingHistory,
    engineGenerating,
    canMutateShell,
    input,
    setInput,
    messages,
    error,
    canSwitchWorkspace,
    permission,
    settingsOpen,
    setSettingsOpen,
    settingsCwd,
    setSettingsCwd,
    keyStatus,
    keyInput,
    setKeyInput,
    keyVisible,
    setKeyVisible,
    savingSettings,
    models,
    selectedModelId,
    modelConfigPath,
    envFilePath,
    draftModelIds,
    contextUsedTokens,
    usageDetail,
    usageDetailLoading,
    fetchUsageDetail,
    reasoningEffort,
    composerRef,
    canSend,
    chatTitle,
    handleNewChat,
    openSettings,
    handleSelectChat,
    handleDeleteChat,
    handleRenameChat,
    pickDirectory,
    selectModel,
    startAddModel,
    discardSelectedDraft,
    removeSelectedModel,
    updateSelectedModel,
    saveSettings,
    switchCurrentModel,
    switchReasoningEffort,
    applyWorkspaceCwd,
    browseWorkspace,
    onSend,
    onCancel,
    onPermission,
    toasts,
    dismissToast,
    pushToast,
    streamDebugOpen,
    toggleStreamDebug,
  }
}

export type DesktopAppApi = ReturnType<typeof useDesktopApp>
