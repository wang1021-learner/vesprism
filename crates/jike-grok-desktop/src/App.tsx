import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  ChatMessage,
  ChatRole,
  ModelEntry,
  ModelSettings,
  PermissionRequest,
  RecentChat,
  SessionEvent,
  SessionStatus,
  ToolCallData,
  ToolCallUpdateData,
} from './types'

import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { MessageList } from './components/Chat/MessageList'
import { Composer } from './components/Composer'
import { SettingsModal } from './components/Modals/SettingsModal'
import { PermissionModal } from './components/Modals/PermissionModal'

import './App.css'

/**
 * 由配置 id 自动生成合法环境变量名（用户无需填写 env_key）。
 * 规则与后端 validate_env_key_name 一致：字母/下划线开头，仅 [A-Za-z0-9_]。
 */
function autoEnvKey(modelId: string): string {
  const body = modelId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  const safe = body && /^[A-Z_]/.test(body) ? body : `M_${body || 'DEFAULT'}`
  return `JIKE_${safe}_API_KEY`
}

/** 已有 env_key 则保留（兼容旧配置）；否则按模型 id 自动生成 */
function resolveEnvKey(entry: { id: string; env_key?: string }): string {
  const existing = entry.env_key?.trim()
  if (existing) return existing
  return autoEnvKey(entry.id)
}

/** 系统提示标签：API 模型 ID + 固定后缀，用户无需填写 */
const SYSTEM_PROMPT_LABEL_SUFFIX = '（由 xAI Grok Build 二次开发框架驱动）'

function autoSystemPromptLabel(apiModelId: string): string {
  const base = apiModelId.trim()
  if (!base) return ''
  return `${base}${SYSTEM_PROMPT_LABEL_SUFFIX}`
}


/** 检测是否运行在 Tauri WebView 环境 */
function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
    isTauri?: boolean
  }
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.isTauri)
}

export default function App() {
  const inTauri = isTauriRuntime()

  // 界面与布局状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [recentChats, setRecentChats] = useState<RecentChat[]>([])
  const [activeChatId, setActiveChatId] = useState('1')

  // 会话与 IPC 状态
  const [status, setStatus] = useState<SessionStatus>('unknown')
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)

  // 设置面板状态
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

  const nextId = useRef(1)
  const streamingRole = useRef<ChatRole | null>(null)
  const autoStarted = useRef(false)

  /** 追加或拼接聊天气泡 */
  const pushMessage = useCallback((role: ChatRole, text: string, append = false) => {
    setMessages((prev) => {
      if (
        append &&
        streamingRole.current === role &&
        prev.length > 0 &&
        prev[prev.length - 1].role === role
      ) {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, text: last.text + text }
        return copy
      }
      streamingRole.current = role
      const id = nextId.current++
      return [...prev, { id, role, text }]
    })
  }, [])

  /** 插入一条工具调用卡片（同一 toolCallId 若已存在则覆盖更新） */
  const upsertToolCall = useCallback((tool: ToolCallData) => {
    streamingRole.current = null
    setMessages((prev) => {
      const idx = prev.findIndex(
        (m) => m.role === 'tool' && m.tool?.toolCallId === tool.toolCallId,
      )
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = {
          ...copy[idx],
          text: tool.detail || tool.title,
          tool: { ...copy[idx].tool!, ...tool },
        }
        return copy
      }
      const id = nextId.current++
      return [
        ...prev,
        {
          id,
          role: 'tool',
          text: tool.detail || tool.title,
          tool,
        },
      ]
    })
  }, [])

  /** 按 toolCallId 合并工具调用增量 */
  const patchToolCall = useCallback((update: ToolCallUpdateData) => {
    streamingRole.current = null
    setMessages((prev) => {
      const idx = prev.findIndex(
        (m) => m.role === 'tool' && m.tool?.toolCallId === update.toolCallId,
      )
      if (idx < 0) {
        // 更新先于创建到达：建一条占位卡片
        const tool: ToolCallData = {
          toolCallId: update.toolCallId,
          kind: update.kind ?? 'other',
          status: update.status ?? 'in_progress',
          title: update.title ?? '工具调用',
          detail: update.detail ?? '',
          preview: update.preview ?? '',
        }
        const id = nextId.current++
        return [...prev, { id, role: 'tool', text: tool.detail || tool.title, tool }]
      }
      const copy = [...prev]
      const old = copy[idx].tool!
      const next: ToolCallData = {
        toolCallId: old.toolCallId,
        kind: update.kind ?? old.kind,
        status: update.status ?? old.status,
        title: update.title ?? old.title,
        detail: update.detail ?? old.detail,
        preview: update.preview ?? old.preview,
      }
      copy[idx] = {
        ...copy[idx],
        text: next.detail || next.title,
        tool: next,
      }
      return copy
    })
  }, [])

  // 订阅 Tauri session-event
  useEffect(() => {
    if (!inTauri) return

    let unlisten: UnlistenFn | undefined
    let cancelled = false

    ;(async () => {
      unlisten = await listen<SessionEvent>('session-event', (event) => {
        const payload = event.payload
        switch (payload.type) {
          case 'agent_text_chunk':
            pushMessage('assistant', payload.text, true)
            break
          case 'agent_thought_chunk':
            pushMessage('thought', payload.text, true)
            break
          case 'user_text_chunk':
            // 发送时已乐观插入完整用户气泡；协议再回显整段时若再 append 会变成「你好你好」。
            // 相同文案直接忽略；仅在真正流式分片（streamingRole===user）时拼接。
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role === 'user') {
                if (last.text === payload.text) {
                  return prev
                }
                if (streamingRole.current === 'user') {
                  const copy = [...prev]
                  copy[copy.length - 1] = { ...last, text: last.text + payload.text }
                  return copy
                }
                // 乐观气泡已在、非流式回显：不重复建泡
                if (last.text.length > 0) {
                  return prev
                }
              }
              streamingRole.current = 'user'
              const id = nextId.current++
              return [...prev, { id, role: 'user', text: payload.text }]
            })
            break
          case 'tool_call':
            upsertToolCall(payload.tool)
            break
          case 'tool_call_update':
            patchToolCall(payload.update)
            break
          case 'turn_ended':
            streamingRole.current = null
            break
          case 'error':
            streamingRole.current = null
            setError(payload.message)
            pushMessage('system', `错误: ${payload.message}`)
            break
          case 'other':
            break
          case 'permission_request':
            setPermission({
              request_id: payload.request_id,
              description: payload.description,
              options: payload.options,
            })
            break
          case 'status_changed':
            setStatus(payload.status)
            break
          case 'session_id_changed':
            setActiveChatId(payload.session_id)
            break
        }
      })
      if (cancelled) unlisten?.()
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [inTauri, pushMessage, upsertToolCall, patchToolCall])

/** 格式化时间戳为易读短文本 */
function formatSessionTime(isoString: string): string {
  if (!isoString) return ''
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return isoString

    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / (1000 * 60))
    const diffHour = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    if (diffHour < 24 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    }

    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${month}-${day}`
  } catch {
    return isoString
  }
}

  /** 从后端刷新历史会话列表 */
  const refreshSessionList = useCallback(async () => {
    try {
      const cwd = await invoke<string>('workspace_cwd')
      const sessions = await invoke<
        { id: string; title: string; updated_at: string; num_messages: number }[]
      >('list_sessions', { cwd })
      setRecentChats(
        sessions.map((s) => ({
          id: s.id,
          title: s.title || '新对话',
          timestamp: formatSessionTime(s.updated_at),
          // 原始 ISO 时间供侧栏按日历日分组（今天 / 昨天 / 前天）
          rawTimestamp: s.updated_at,
        })),
      )
    } catch (e) {
      console.error('刷新会话列表失败', e)
    }
  }, [])

  /** 从磁盘加载模型列表（启动 / 保存后刷新，供 Composer 下拉使用）。返回应对齐会话的模型 id。 */
  const loadModelsFromDisk = useCallback(async (): Promise<string> => {
    if (!inTauri) return ''
    try {
      const modelSettings = await invoke<ModelSettings>('get_model_settings')
      setModels(modelSettings.models)
      setModelConfigPath(modelSettings.config_path)
      const pick =
        modelSettings.default_id &&
        modelSettings.models.some((m) => m.id === modelSettings.default_id)
          ? modelSettings.default_id
          : (modelSettings.models[0]?.id ?? '')
      let resolved = pick
      if (pick) {
        setSelectedModelId((prev) => {
          const next = modelSettings.models.some((m) => m.id === prev) ? prev : pick
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

  /**
   * 把运行中会话的模型同步到 UI 选中项（含 system 人设）。
   * 启动/新会话后必须调用，否则下拉是 pro、引擎仍是默认 flash。
   */
  const syncSessionModel = useCallback(async (modelId: string) => {
    const id = modelId.trim()
    if (!id) return
    try {
      await invoke('set_current_model', { modelId: id })
      setSelectedModelId(id)
    } catch (e) {
      console.warn('同步会话模型失败', e)
    }
  }, [])

  /** 启动进程内 Agent 会话（首次进入；若已有会话则后端会安全重建） */
  const startSession = useCallback(async () => {
    if (!inTauri || starting) return
    setStarting(true)
    setError(null)
    try {
      // 先拉模型列表，Composer 下拉立即可用
      const modelId = await loadModelsFromDisk()
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('start_session', { cwd })
      setReady(true)
      // 关键：会话模型与下拉/默认配置对齐（含自报家门）
      await syncSessionModel(modelId)
      // 空会话不进列表，这里刷新是为了拿到历史；不强制插「新对话」
      void refreshSessionList()
    } catch (e) {
      const msg = String(e)
      setError(msg)
      pushMessage('system', `启动失败: ${msg}`)
    } finally {
      setStarting(false)
    }
  }, [
    inTauri,
    starting,
    pushMessage,
    refreshSessionList,
    loadModelsFromDisk,
    syncSessionModel,
  ])

  /**
   * 新建 / 重启会话：
   * - 当前会话若从未发送用户消息，先从侧栏移除，后端会删除空磁盘记录
   * - 防连点：starting 时忽略
   */
  const restartSession = useCallback(async () => {
    if (!inTauri || starting) return
    const hadUserMessage = messages.some((m) => m.role === 'user')
    const prevId = activeChatId
    // 新会话沿用当前下拉模型；若为空再读默认
    const modelToUse = selectedModelId

    streamingRole.current = null
    setMessages([])
    setPermission(null)
    setError(null)
    setReady(false)
    setStarting(true)

    // 空会话：立刻从侧栏去掉，避免闪一下「新对话」
    if (!hadUserMessage && prevId) {
      setRecentChats((prev) => prev.filter((c) => c.id !== prevId))
    }

    try {
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('restart_session', { cwd })
      setReady(true)
      const id = modelToUse.trim() || (await loadModelsFromDisk())
      await syncSessionModel(id)
      void refreshSessionList()
    } catch (e) {
      const msg = String(e)
      setError(msg)
      pushMessage('system', `新建会话失败: ${msg}`)
    } finally {
      setStarting(false)
    }
  }, [
    inTauri,
    starting,
    messages,
    activeChatId,
    selectedModelId,
    pushMessage,
    refreshSessionList,
    loadModelsFromDisk,
    syncSessionModel,
  ])

  /** 首次挂载自动启动会话 */
  useEffect(() => {
    if (!inTauri) return
    if (autoStarted.current) return
    autoStarted.current = true
    void startSession()
  }, [inTauri, startSession])

  /** 新建会话（侧栏 New chat / Header 新会话） */
  const handleNewChat = useCallback(() => {
    if (starting) return
    void restartSession()
  }, [restartSession, starting])

  /** 选择会话 */
  const handleSelectChat = useCallback(
    async (id: string) => {
      if (!inTauri || loadingSession || starting) return
      if (id === activeChatId && ready) return

      const hadUserMessage = messages.some((m) => m.role === 'user')
      const prevId = activeChatId

      streamingRole.current = null
      setMessages([])
      setPermission(null)
      setError(null)
      setReady(false)
      setLoadingSession(true)

      // 从空会话切走：侧栏先去掉空项（后端也会删磁盘）
      if (!hadUserMessage && prevId && prevId !== id) {
        setRecentChats((prev) => prev.filter((c) => c.id !== prevId))
      }

      try {
        const cwd = await invoke<string>('workspace_cwd')
        await invoke('load_session', { sessionId: id, cwd })
        setReady(true)
        // 恢复会话后也与当前下拉模型对齐（避免人设仍是旧默认）
        const modelId = selectedModelId.trim() || (await loadModelsFromDisk())
        await syncSessionModel(modelId)
        void refreshSessionList()
      } catch (e) {
        const msg = String(e)
        setError(msg)
        pushMessage('system', `恢复会话失败: ${msg}`)
        setReady(false)
      } finally {
        setLoadingSession(false)
      }
    },
    [
      inTauri,
      loadingSession,
      starting,
      activeChatId,
      ready,
      messages,
      selectedModelId,
      pushMessage,
      refreshSessionList,
      loadModelsFromDisk,
      syncSessionModel,
    ],
  )

  /** 刷新 API Key 校验状态 */
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

  /** 打开设置弹窗 */
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
      // 补全缺失的 env_key（界面不展示，保存时写入）
      const normalized = modelSettings.models.map((m) => ({
        ...m,
        env_key: resolveEnvKey(m),
      }))
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

  /** 选择本地文件夹 */
  const pickDirectory = useCallback(async () => {
    const selected = await openDialog({ directory: true, defaultPath: settingsCwd || undefined })
    if (typeof selected === 'string') {
      setSettingsCwd(selected)
    }
  }, [settingsCwd])

  /** 选择模型 */
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

  /** Header 快捷切模型：不重启会话，仅切换协议层当前使用的模型 */
  const switchCurrentModel = useCallback(
    async (modelId: string) => {
      if (!inTauri || !ready) return
      try {
        await invoke('set_current_model', { modelId })
        setSelectedModelId(modelId)
        const entry = models.find((m) => m.id === modelId)
        const label = entry?.model || modelId
        pushMessage('system', `已切换模型 · ${label}`)
      } catch (e) {
        setError(String(e))
      }
    },
    [inTauri, ready, models, pushMessage],
  )

  /** 更新模型字段 */
  const updateSelectedModel = useCallback(
    (patch: Partial<ModelEntry>) => {
      setModels((prev) =>
        prev.map((m) => (m.id === selectedModelId ? { ...m, ...patch } : m)),
      )
    },
    [selectedModelId],
  )

  /** 新增草稿模型：配置 id 自动随机生成，用户无需填写 */
  const startAddModel = useCallback(() => {
    const existing = new Set(models.map((m) => m.id))
    let id = ''
    for (let i = 0; i < 24; i++) {
      // 合法字符：字母数字 _ - .（与后端 validate_model_id 一致）
      const suffix =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const candidate = `m-${suffix}`
      if (!existing.has(candidate)) {
        id = candidate
        break
      }
    }
    if (!id) {
      id = `m-${Date.now().toString(36)}`
    }
    const template = models.find((m) => m.id === selectedModelId) ?? models[0]
    const envKey = autoEnvKey(id)
    const draft: ModelEntry = {
      id,
      name: '',
      model: '',
      base_url: template?.base_url ?? '',
      env_key: envKey,
      context_window: 0,
      system_prompt_label: '',
    }
    setModels((prev) => [...prev, draft])
    setDraftModelIds((prev) => [...prev, id])
    setSelectedModelId(id)
    setKeyInput('')
    setKeyVisible(false)
    void refreshKeyStatus(envKey)
  }, [models, selectedModelId, refreshKeyStatus])

  /** 放弃新增模型 */
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

  /** 删除当前选中模型（仅改内存；点保存后同步到 config.toml） */
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

  /**
   * 保存设置（市面常见体验）：
   * 写盘 → 热重载模型目录 → 可选切换当前会话模型；
   * **不** restart_session，**不**清空聊天。
   */
  const saveSettings = useCallback(async () => {
    setSavingSettings(true)
    try {
      if (models.length === 0) {
        throw new Error('至少需要配置一个模型')
      }
      // 显示名 / env_key / 系统提示自动处理；上下文窗口由用户自行填写（单位 K）
      const trimmedModels = models.map((m) => {
        const model = m.model.trim()
        const id = m.id.trim()
        if (!(m.context_window > 0)) {
          throw new Error(
            `模型「${model || id || '未命名'}」请填写上下文窗口 (K)，例如 128、256、1000`,
          )
        }
        return {
          ...m,
          id,
          env_key: resolveEnvKey({ id, env_key: m.env_key }),
          base_url: m.base_url.trim(),
          model,
          name: model,
          system_prompt_label: autoSystemPromptLabel(model),
          context_window: m.context_window,
        }
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

      // 热重载 catalog（官方 reload_models），不清会话
      await invoke('reload_models')

      // 把当前会话切到选中的模型（若会话已就绪）
      if (ready) {
        try {
          await invoke('set_current_model', { modelId: defaultId })
        } catch (e) {
          // catalog 已更新，切换失败不回滚写盘
          console.warn('保存后切换会话模型失败', e)
        }
      }

      setModels(trimmedModels)
      setSelectedModelId(defaultId)
      setDraftModelIds([])
      setError(null)
      const entry = trimmedModels.find((m) => m.id === defaultId)
      const modelLabel = entry?.model || defaultId || '默认'
      pushMessage(
        'system',
        `模型配置已保存 · 当前使用 ${modelLabel}（未中断对话）`,
      )
      setSettingsOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingSettings(false)
    }
  }, [keyInput, pushMessage, models, selectedModelId, ready])

  /** 发送消息 */
  const onSend = async () => {
    const text = input.trim()
    if (!text || !ready || status === 'generating') return
    setInput('')
    setError(null)
    streamingRole.current = null
    // 若是本会话第一条用户消息，同步更新侧栏标题（与 Header 标题一致）
    const isFirstUserMessage = !messages.some((m) => m.role === 'user')
    if (isFirstUserMessage) {
      const title = text.replace(/\s+/g, ' ')
      setRecentChats((prev) => {
        const exists = prev.some((c) => c.id === activeChatId)
        if (exists) {
          return prev.map((c) => (c.id === activeChatId ? { ...c, title } : c))
        }
        // 新建会话尚未出现在列表时，插入一条当前会话摘要
        return [
          {
            id: activeChatId,
            title,
            timestamp: '刚刚',
            rawTimestamp: new Date().toISOString(),
          },
          ...prev,
        ]
      })
    }
    // 乐观展示用户气泡；立刻清掉 streamingRole，避免协议 UserMessage 回显再 append 成双份
    pushMessage('user', text)
    streamingRole.current = null
    try {
      await invoke('send_prompt', { text })
    } catch (e) {
      const msg = String(e)
      setError(msg)
      pushMessage('system', `发送失败: ${msg}`)
    }
  }

  /** 取消生成 */
  const onCancel = async () => {
    try {
      await invoke('cancel_turn')
    } catch (e) {
      setError(String(e))
    }
  }

  /** 回答权限选项 */
  const onPermission = async (optionId: string) => {
    if (!permission) return
    const { request_id } = permission
    setPermission(null)
    try {
      await invoke('respond_permission', {
        requestId: request_id,
        optionId,
      })
    } catch (e) {
      setError(String(e))
    }
  }

  /** 删除指定历史会话（当前会话由后端释放后自动开新会话，勿再调 New chat） */
  const handleDeleteChat = useCallback(
    async (id: string) => {
      if (!inTauri || starting || loadingSession) return
      const deletingActive = id === activeChatId

      // 乐观从侧栏移除
      setRecentChats((prev) => prev.filter((c) => c.id !== id))

      if (deletingActive) {
        streamingRole.current = null
        setMessages([])
        setPermission(null)
        setError(null)
        setReady(false)
        setStarting(true)
      }

      try {
        const cwd = await invoke<string>('workspace_cwd')
        await invoke('delete_session', { sessionId: id, cwd })
        if (deletingActive) {
          setReady(true)
        }
        void refreshSessionList()
      } catch (e) {
        const msg = String(e)
        setError(`删除会话失败: ${msg}`)
        void refreshSessionList()
      } finally {
        if (deletingActive) {
          setStarting(false)
        }
      }
    },
    [inTauri, starting, loadingSession, activeChatId, refreshSessionList],
  )

  /** 重命名历史会话标题（写入官方 summary.json） */
  const handleRenameChat = useCallback(
    async (id: string, title: string) => {
      if (!inTauri) {
        throw new Error('请在桌面应用中操作')
      }
      const next = title.trim()
      if (!next) {
        throw new Error('标题不能为空')
      }
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('rename_session', {
        sessionId: id,
        cwd,
        title: next,
      })
      // 乐观更新侧栏（Header 依赖 recentChats 标题）
      setRecentChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: next } : c)),
      )
      void refreshSessionList()
    },
    [inTauri, refreshSessionList],
  )

  const canSend = inTauri && ready && status !== 'generating' && status !== 'initializing'

  /**
   * 当前对话标题：
   * 1. 侧栏摘要（含手动重命名、首条提问同步）优先 —— 重命名后 Header 立即一致
   * 2. 否则取本轮用户第一句话
   * 3. 否则「新对话」
   */
  const chatTitle = useMemo(() => {
    const fromList = recentChats.find((c) => c.id === activeChatId)?.title?.trim()
    if (fromList && fromList !== '新对话') return fromList
    const firstUser = messages.find((m) => m.role === 'user' && m.text.trim())
    if (firstUser) {
      return firstUser.text.trim().replace(/\s+/g, ' ')
    }
    return fromList || '新对话'
  }, [messages, recentChats, activeChatId])

  // 普通浏览器误开防护引导
  if (!inTauri) {
    return (
      <div className="browser-gate">
        <div className="browser-gate-card">
          <h1>请用桌面应用打开</h1>
          <p>当前运行在普通浏览器中，缺少 Tauri 原生桥接支持。</p>
          <pre className="browser-gate-cmd">
            {`cd crates/jike-grok-desktop\ncargo tauri dev`}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* 左侧边栏组件 */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onNewChat={handleNewChat}
        onOpenSettings={() => void openSettings()}
        recentChats={recentChats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
      />

      {/* 主视窗 */}
      <div className="main-viewport">
        {/* 顶部 Header 组件 */}
        <Header
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          status={status}
          ready={ready}
          starting={starting}
          chatTitle={chatTitle}
          onStartSession={() => void startSession()}
          onRestartSession={() => void restartSession()}
        />

        {error && <div className="banner error">{error}</div>}

        {/* 消息列表组件 */}
        <MessageList
          messages={messages}
          permission={permission}
          loadingSession={loadingSession}
          sessionKey={activeChatId}
        />

        {/* 悬浮 Composer 输入框组件 */}
        <Composer
          input={input}
          setInput={setInput}
          canSend={canSend}
          isGenerating={status === 'generating'}
          ready={ready}
          models={models}
          selectedModelId={selectedModelId}
          onSwitchModel={(id) => void switchCurrentModel(id)}
          onSend={() => void onSend()}
          onCancel={() => void onCancel()}
        />

        {/* 权限确认弹窗 */}
        {permission && (
          <PermissionModal permission={permission} onRespond={(id) => void onPermission(id)} />
        )}

        {/* 设置弹窗 */}
        {settingsOpen && (
          <SettingsModal
            settingsCwd={settingsCwd}
            setSettingsCwd={setSettingsCwd}
            pickDirectory={() => void pickDirectory()}
            models={models}
            selectedModelId={selectedModelId}
            selectModel={selectModel}
            draftModelIds={draftModelIds}
            startAddModel={startAddModel}
            discardSelectedDraft={discardSelectedDraft}
            removeSelectedModel={removeSelectedModel}
            updateSelectedModel={updateSelectedModel}
            modelConfigPath={modelConfigPath}
            keyStatus={keyStatus}
            keyInput={keyInput}
            setKeyInput={setKeyInput}
            keyVisible={keyVisible}
            setKeyVisible={setKeyVisible}
            envFilePath={envFilePath}
            savingSettings={savingSettings}
            onClose={() => setSettingsOpen(false)}
            onSave={() => void saveSettings()}
          />
        )}
      </div>
    </div>
  )
}
