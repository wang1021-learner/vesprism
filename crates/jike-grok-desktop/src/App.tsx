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
import { emptyModelEntry } from './types'

import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { MessageList } from './components/Chat/MessageList'
import { Composer, type ComposerHandle } from './components/Composer'
import { SettingsModal } from './components/Modals/SettingsModal'
import { PermissionModal } from './components/Modals/PermissionModal'
import { ArtifactProvider } from './context/ArtifactContext'
import { ArtifactPanel } from './components/ArtifactPanel'

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

/** 后端可能缺新字段，统一补齐默认值 */
function normalizeModelFromDisk(m: ModelEntry): ModelEntry {
  const model = (m.model || '').trim()
  return emptyModelEntry({
    ...m,
    id: m.id,
    model,
    name: model, // 展示名 = 模型名称
    env_key: resolveEnvKey(m),
    api_backend: m.api_backend || 'chat_completions',
    description: m.description ?? '',
    temperature: m.temperature ?? 0,
    top_p: m.top_p ?? 0,
    max_completion_tokens: m.max_completion_tokens ?? 0,
    extra_headers: m.extra_headers ?? {},
    api_base_url: m.api_base_url ?? '',
    max_retries: m.max_retries ?? 0,
    inference_idle_timeout_secs: m.inference_idle_timeout_secs ?? 0,
    stream_tool_calls:
      m.stream_tool_calls === undefined ? null : m.stream_tool_calls,
    agent_type: m.agent_type || 'grok-build',
    use_concise: Boolean(m.use_concise),
    auto_compact_threshold_percent: m.auto_compact_threshold_percent ?? 0,
    supports_reasoning_effort: Boolean(m.supports_reasoning_effort),
    reasoning_effort: m.reasoning_effort || (m.supports_reasoning_effort ? 'medium' : ''),
    hidden: Boolean(m.hidden),
    supported_in_api: m.supported_in_api !== false,
    laziness_enabled: Boolean(m.laziness_enabled),
    laziness_max_nudges: m.laziness_max_nudges ?? 0,
    compactions_remaining: m.compactions_remaining ?? '',
    compaction_at_tokens: m.compaction_at_tokens ?? '',
  })
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
  /** 当前 Agent 工作目录（侧栏「当前工作空间」标记） */
  const [workspaceCwd, setWorkspaceCwd] = useState('')
  const [activeChatId, setActiveChatId] = useState('1')

  /** 从 recentChats + 当前 workspaceCwd 派生去重后的工作区列表 */
  const workspaceOptions = useMemo(() => {
    const seen = new Map<string, string>() // normalized -> original cwd
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

  // 会话与 IPC 状态
  const [status, setStatus] = useState<SessionStatus>('unknown')
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)

  // 当前是否允许切换工作区：仅当会话已就绪、不在过度状态，且为空（还没有任何用户消息）时允许
  const canSwitchWorkspace =
    ready && !loadingSession && !starting && !messages.some((m) => m.role === 'user')
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([])
  const permission = permissionQueue[0] ?? null

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
  /** 会话累计 token 用量（来自 meta.totalTokens） */
  const [contextUsedTokens, setContextUsedTokens] = useState(0)
  /** 当前会话推理强度（仅 supports_reasoning 模型使用） */
  const [reasoningEffort, setReasoningEffort] = useState('medium')

  const composerRef = useRef<ComposerHandle>(null)
  const nextId = useRef(1)
  const streamingRole = useRef<ChatRole | null>(null)
  const pendingPromptIds = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const autoStarted = useRef(false)
  /** 流式打字机缓释队列：同一角色的高频 chunk 在每帧匀速平滑吐字，完全消除文字突跳感 */
  const typewriterRef = useRef<{
    role: ChatRole
    pendingText: string
  } | null>(null)
  const typewriterRafRef = useRef(0)

  /**
   * 将打字机缓冲并入 messages。
   * 追加判定以「末条消息 role」为准，不依赖 streamingRole：
   * 避免工具卡片路径先把 streamingRole 置 null 后再 flush 时误拆成新气泡。
   */
  const flushTypewriterBufferInto = useCallback((prev: ChatMessage[]): ChatMessage[] => {
    const state = typewriterRef.current
    if (!state || !state.pendingText) {
      typewriterRef.current = null
      return prev
    }
    const { role, pendingText } = state
    typewriterRef.current = null
    if (prev.length > 0 && prev[prev.length - 1].role === role) {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      copy[copy.length - 1] = { ...last, text: last.text + pendingText }
      return copy
    }
    streamingRole.current = role
    return [...prev, { id: nextId.current++, role, text: pendingText }]
  }, [])

  /** 立刻冲刷打字机缓冲（角色切换 / turn 结束 / 工具卡片前），避免丢字 */
  const flushTypewriterNow = useCallback(() => {
    if (typewriterRafRef.current) {
      cancelAnimationFrame(typewriterRafRef.current)
      typewriterRafRef.current = 0
    }
    if (!typewriterRef.current?.pendingText) {
      typewriterRef.current = null
      return
    }
    setMessages((prev) => flushTypewriterBufferInto(prev))
  }, [flushTypewriterBufferInto])

  /** 丢弃打字机队列（切会话 / 新建 / 发送前），防止旧 rAF 往新会话灌字 */
  const discardTypewriter = useCallback(() => {
    if (typewriterRafRef.current) {
      cancelAnimationFrame(typewriterRafRef.current)
      typewriterRafRef.current = 0
    }
    typewriterRef.current = null
  }, [])

  /** 安全截取：按码点切片，避免 emoji 等代理对被拦腰截断 */
  const takeCodePoints = (s: string, maxUnits: number): [string, string] => {
    if (s.length <= maxUnits) return [s, '']
    let i = 0
    let taken = 0
    while (i < s.length && taken < maxUnits) {
      const cp = s.codePointAt(i)!
      i += cp > 0xffff ? 2 : 1
      taken += 1
    }
    return [s.slice(0, i), s.slice(i)]
  }

  /** 帧渲染回调：根据积压字数平滑匀速输出字符 */
  const stepTypewriter = useCallback(() => {
    typewriterRafRef.current = 0
    const state = typewriterRef.current
    if (!state || !state.pendingText) {
      typewriterRef.current = null
      return
    }

    // 动态计算本帧吐字数：大量积压时适当提速防落后，少量积压时匀速微量平滑打字
    const len = state.pendingText.length
    const takeCount = len > 40 ? Math.ceil(len / 3) : len > 15 ? 3 : len > 6 ? 2 : 1
    const [chunk, rest] = takeCodePoints(state.pendingText, takeCount)
    state.pendingText = rest

    setMessages((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].role === state.role) {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, text: last.text + chunk }
        streamingRole.current = state.role
        return copy
      }
      streamingRole.current = state.role
      return [...prev, { id: nextId.current++, role: state.role, text: chunk }]
    })

    if (state.pendingText.length > 0) {
      typewriterRafRef.current = requestAnimationFrame(stepTypewriter)
    } else {
      typewriterRef.current = null
    }
  }, [])

  /** 追加或拼接聊天气泡（流式 append 经过打字机缓释队列） */
  const pushMessage = useCallback(
    (role: ChatRole, text: string, append = false, promptId?: string) => {
      // 同角色流式追加：入打字机缓释队列，逐帧匀速打印
      if (append && (streamingRole.current === role || !streamingRole.current)) {
        if (typewriterRef.current && typewriterRef.current.role === role) {
          typewriterRef.current.pendingText += text
        } else {
          flushTypewriterNow()
          typewriterRef.current = { role, pendingText: text }
        }
        if (!typewriterRafRef.current) {
          typewriterRafRef.current = requestAnimationFrame(stepTypewriter)
        }
        return
      }

      // 新气泡 / 角色切换：先冲刷旧缓冲，再写入
      flushTypewriterNow()
      streamingRole.current = role
      setMessages((prev) => [...prev, { id: nextId.current++, role, text, promptId }])
    },
    [flushTypewriterNow, stepTypewriter],
  )

  /** 插入一条工具调用卡片（同一 toolCallId 若已存在则覆盖更新） */
  const upsertToolCall = useCallback(
    (tool: ToolCallData) => {
      if (typewriterRafRef.current) {
        cancelAnimationFrame(typewriterRafRef.current)
        typewriterRafRef.current = 0
      }
      // 先 flush（依赖末条 role），再清 streamingRole，避免误拆新气泡
      setMessages((prev) => {
        const base = flushTypewriterBufferInto(prev)
        streamingRole.current = null
        const idx = base.findIndex(
          (m) => m.role === 'tool' && m.tool?.toolCallId === tool.toolCallId,
        )
        if (idx >= 0) {
          const copy = [...base]
          copy[idx] = {
            ...copy[idx],
            text: tool.detail || tool.title,
            tool: { ...copy[idx].tool!, ...tool },
          }
          return copy
        }
        return [
          ...base,
          {
            id: nextId.current++,
            role: 'tool',
            text: tool.detail || tool.title,
            tool,
          },
        ]
      })
    },
    [flushTypewriterBufferInto],
  )

  /** 按 toolCallId 合并工具调用增量 */
  const patchToolCall = useCallback(
    (update: ToolCallUpdateData) => {
      if (typewriterRafRef.current) {
        cancelAnimationFrame(typewriterRafRef.current)
        typewriterRafRef.current = 0
      }
      setMessages((prev) => {
        const base = flushTypewriterBufferInto(prev)
        streamingRole.current = null
        const idx = base.findIndex(
          (m) => m.role === 'tool' && m.tool?.toolCallId === update.toolCallId,
        )
        if (idx < 0) {
          const tool: ToolCallData = {
            toolCallId: update.toolCallId,
            kind: update.kind ?? 'other',
            status: update.status ?? 'in_progress',
            title: update.title ?? '工具调用',
            detail: update.detail ?? '',
            preview: update.preview ?? '',
          }
          return [
            ...base,
            { id: nextId.current++, role: 'tool', text: tool.detail || tool.title, tool },
          ]
        }
        const copy = [...base]
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
    },
    [flushTypewriterBufferInto],
  )

  // 订阅 Tauri session-event
  useEffect(() => {
    if (!inTauri) return

    let unlisten: UnlistenFn | undefined
    let cancelled = false

      ; (async () => {
        unlisten = await listen<SessionEvent>('session-event', (event) => {
          const payload = event.payload
          switch (payload.type) {
            case 'agent_text_chunk':
              pushMessage('assistant', payload.text, true)
              break
            case 'agent_thought_chunk':
              pushMessage('thought', payload.text, true)
              break
            case 'user_text_chunk': {
              const pid = payload.prompt_id
              if (pid && pendingPromptIds.current.has(pid)) {
                // 命中自己主动发送的消息回显：忽略，避免重复渲染
                break
              }
              if (streamingRole.current === 'user') {
                pushMessage('user', payload.text, true)
              } else {
                pushMessage('user', payload.text)
                streamingRole.current = 'user'
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
              const pid = payload.prompt_id
              if (pid) {
                const t = pendingPromptIds.current.get(pid)
                if (t) clearTimeout(t)
                pendingPromptIds.current.delete(pid)
              }
              flushTypewriterNow()
              streamingRole.current = null
              break
            }
            case 'error': {
              const pid = payload.prompt_id
              if (pid) {
                const t = pendingPromptIds.current.get(pid)
                if (t) clearTimeout(t)
                pendingPromptIds.current.delete(pid)
              }
              flushTypewriterNow()
              streamingRole.current = null
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
  }, [inTauri, pushMessage, upsertToolCall, patchToolCall, flushTypewriterNow])

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

  /** 从后端刷新历史会话列表（全工作空间，供侧栏两层分组） */
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
      >('list_sessions', { cwd })
      setRecentChats(
        sessions.map((s) => ({
          id: s.id,
          title: s.title || '新对话',
          timestamp: formatSessionTime(s.updated_at),
          // 原始 ISO 时间供侧栏按日历日分组（今天 / 昨天 / 前天）
          rawTimestamp: s.updated_at,
          cwd: s.cwd || cwd,
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

  /**
   * 把运行中会话的模型同步到 UI 选中项（含 system 人设）。
   * 启动/新会话后必须调用，否则下拉是 pro、引擎仍是默认 flash。
   * 支持推理的模型会带上 meta.reasoningEffort。
   */
  const syncSessionModel = useCallback(
    async (modelId: string, effortOverride?: string) => {
      const id = modelId.trim()
      if (!id) return
      const entry = models.find((m) => m.id === id)
      const effort = entry?.supports_reasoning_effort
        ? (effortOverride || entry.reasoning_effort || reasoningEffort || 'medium')
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

  /** 进应用静默拉起引擎；成功无提示，失败才 setError。 */
  const startSession = useCallback(async () => {
    if (!inTauri || starting) return
    setStarting(true)
    setError(null)
    try {
      const modelId = await loadModelsFromDisk()
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('start_session', { cwd })
      setReady(true)
      await syncSessionModel(modelId)
      void refreshSessionList()
    } catch (e) {
      setReady(false)
      const msg = String(e)
      setError(msg)
    } finally {
      setStarting(false)
    }
  }, [inTauri, starting, refreshSessionList, loadModelsFromDisk, syncSessionModel])

  /**
   * New chat：用户只看到「空白新对话」。
   * 底层重建 agent 全程静默，不展示创建中/启动中文案。
   */
  const restartSession = useCallback(async () => {
    if (!inTauri || starting) return
    const hadUserMessage = messages.some((m) => m.role === 'user')
    const prevId = activeChatId
    const modelToUse = selectedModelId

    discardTypewriter()
    streamingRole.current = null
    setMessages([])
    setContextUsedTokens(0)
    setPermissionQueue([])
    setError(null)
    setInput('')
    // 保持界面像「已就绪的空对话」：不闪「请先…/创建中…」
    // 发送仍由 canSend（ready && !starting）拦住，避免打到旧会话
    setStarting(true)

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
      setReady(false)
      const msg = String(e)
      setError(msg)
      // 仅失败时提示；成功路径零系统消息
      pushMessage('system', `出了点问题: ${msg}`)
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
    discardTypewriter,
  ])

  /** 首次挂载自动启动会话 */
  useEffect(() => {
    if (!inTauri) return
    if (autoStarted.current) return
    autoStarted.current = true
    void startSession()
  }, [inTauri, startSession])

  /** 新建会话（侧栏 New chat；顶栏不再重复「新会话」） */
  const handleNewChat = useCallback(() => {
    if (starting) return
    void restartSession()
  }, [restartSession, starting])

  /** 选择会话（cwd 来自侧栏条目，跨工作空间打开时必须用会话自己的路径） */
  const handleSelectChat = useCallback(
    async (id: string, sessionCwd?: string) => {
      if (!inTauri || loadingSession || starting) return
      if (id === activeChatId && ready) return

      const hadUserMessage = messages.some((m) => m.role === 'user')
      const prevId = activeChatId
      const fromList = recentChats.find((c) => c.id === id)

      discardTypewriter()
      streamingRole.current = null
      setMessages([])
      setContextUsedTokens(0)
      setPermissionQueue([])
      setError(null)
      setReady(false)
      setLoadingSession(true)
      // 立即高亮目标会话：侧栏可在 load 完成前完成展开/定位，避免等 session_id 事件才滚一次
      setActiveChatId(id)

      // 从空会话切走：侧栏先去掉空项（后端也会删磁盘）
      if (!hadUserMessage && prevId && prevId !== id) {
        setRecentChats((prev) => prev.filter((c) => c.id !== prevId))
      }

      try {
        const fallbackCwd = await invoke<string>('workspace_cwd')
        // 打开 B 的历史 = 现在就在 B 工作区操作（Agent + UI「当前」一致）
        const cwd = (sessionCwd || fromList?.cwd || fallbackCwd).trim() || fallbackCwd
        await invoke('load_session', { sessionId: id, cwd })
        setReady(true)
        try {
          const appliedCwd = await invoke<string>('set_workspace_cwd', { cwd })
          setWorkspaceCwd(appliedCwd)
          setSettingsCwd(appliedCwd)
        } catch (e) {
          // 持久化失败不应该阻断会话已经成功加载这件事，
          // 只是下次启动可能不会记住这次跨工作区打开的目录，
          // 仍然用 load_session 返回时的 cwd 更新展示，兜底降级
          console.warn('持久化跨工作区 cwd 失败', e)
          setWorkspaceCwd(cwd)
          setSettingsCwd(cwd)
        }

        // 恢复会话后也与当前下拉模型对齐（避免人设仍是旧默认）
        const modelId = selectedModelId.trim() || (await loadModelsFromDisk())
        await syncSessionModel(modelId)
        // 不在此处全量 refreshSessionList：列表数据已够用，整表刷新会打散侧栏 DOM/滚动。
      } catch (e) {
        const msg = String(e)
        setError(msg)
        pushMessage('system', `恢复会话失败: ${msg}`)
        setReady(false)
        // 恢复失败时收回高亮，避免侧栏停在未加载成功的项上
        setActiveChatId(prevId)
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
      recentChats,
      selectedModelId,
      pushMessage,
      loadModelsFromDisk,
      syncSessionModel,
      discardTypewriter,
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

  /** 输入栏切换模型：不重启会话；支持推理则带上当前思考强度 */
  const switchCurrentModel = useCallback(
    async (modelId: string) => {
      if (!inTauri || !ready) return
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
        pushMessage('system', `已切换模型 · ${label}`)
      } catch (e) {
        setError(String(e))
      }
    },
    [inTauri, ready, models, pushMessage, reasoningEffort],
  )

  /** 切换思考强度（同模型 + meta.reasoningEffort，Claude/Codex 交互） */
  const switchReasoningEffort = useCallback(
    async (effort: string) => {
      if (!inTauri || !ready || !selectedModelId) return
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
    [inTauri, ready, selectedModelId, models],
  )

  /** 应用一个新的工作目录（已知路径，不弹系统对话框），
   *  必要时重启会话；这是"浏览选择"和"下拉选已知工作区"的共同落地逻辑 */
  const applyWorkspaceCwd = useCallback(
    async (nextCwd: string) => {
      const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (norm(nextCwd) === norm(workspaceCwd)) return
      try {
        const appliedCwd = await invoke<string>('set_workspace_cwd', { cwd: nextCwd })
        setWorkspaceCwd(appliedCwd)
        setSettingsCwd(appliedCwd)
        if (ready) {
          streamingRole.current = null
          setMessages([])
          setContextUsedTokens(0)
          setPermissionQueue([])
          setReady(false)
          setStarting(true)
          try {
            await invoke('restart_session', { cwd: appliedCwd })
            setReady(true)
            await syncSessionModel(selectedModelId)
            pushMessage(
              'system',
              `工作目录已切换 · ${appliedCwd}`,
            )
          } finally {
            setStarting(false)
          }
          void refreshSessionList()
        } else {
          void refreshSessionList()
          pushMessage(
            'system',
            `工作目录已保存 · ${appliedCwd}（下次新对话生效）`,
          )
        }
      } catch (e) {
        setError(String(e))
      }
    },
    [workspaceCwd, ready, selectedModelId, syncSessionModel, pushMessage, refreshSessionList],
  )

  /** 浏览选择一个全新的文件夹（弹系统对话框），选中后走公共应用逻辑 */
  const browseWorkspace = useCallback(async () => {
    const selected = await openDialog({ directory: true, defaultPath: workspaceCwd || undefined })
    if (typeof selected === 'string' && selected.trim()) {
      await applyWorkspaceCwd(selected.trim())
    }
  }, [workspaceCwd, applyWorkspaceCwd])

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
      temperature: 0,
      top_p: 0,
      max_completion_tokens: 0,
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
   * 保存设置：
   * - 工作目录：持久化；若变更且会话已就绪则 restart_session（清空当前聊天）
   * - 模型：写盘 → reload_models → set_current_model（不中断对话，除非 cwd 也变了）
   */
  const saveSettings = useCallback(async () => {
    setSavingSettings(true)
    try {
      if (models.length === 0) {
        throw new Error('至少需要配置一个模型')
      }

      // —— 工作目录 ——
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

      // —— 模型（对齐官方 [model.*] 常用字段）——
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
          name: model, // 展示名固定等于模型名称
          description: (m.description || '').trim(),
          system_prompt_label: autoSystemPromptLabel(model),
          context_window: m.context_window,
          api_backend: backend,
          temperature: m.temperature > 0 ? m.temperature : 0,
          top_p: m.top_p > 0 ? m.top_p : 0,
          max_completion_tokens: m.max_completion_tokens > 0 ? m.max_completion_tokens : 0,
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

      // 热重载 catalog
      await invoke('reload_models')

      setModels(trimmedModels)
      setSelectedModelId(defaultId)
      setDraftModelIds([])
      setError(null)

      const entry = trimmedModels.find((m) => m.id === defaultId)
      const modelLabel = entry?.model || defaultId || '默认'

      if (cwdChanged && ready) {
        // 工作区变了：必须重建会话，否则工具仍在旧目录
        streamingRole.current = null
        setMessages([])
        setContextUsedTokens(0)
        setPermissionQueue([])
        setReady(false)
        setStarting(true)
        try {
          await invoke('restart_session', { cwd: appliedCwd })
          setReady(true)
          await syncSessionModel(defaultId)
          pushMessage(
            'system',
            `工作目录已切换 · ${appliedCwd}`,
          )
        } finally {
          setStarting(false)
        }
        void refreshSessionList()
      } else {
        if (ready) {
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
          // 尚未 start 过：只刷新列表与状态
          setWorkspaceCwd(appliedCwd)
          void refreshSessionList()
          pushMessage(
            'system',
            `工作目录已保存 · ${appliedCwd}（下次新对话生效）`,
          )
        } else {
          pushMessage(
            'system',
            `模型配置已保存 · 当前使用 ${modelLabel}（未中断对话）`,
          )
        }
      }

      return { ok: true }
    } catch (e) {
      const msg = String(e)
      setError(msg)
      return { ok: false, error: msg }
    } finally {
      setSavingSettings(false)
    }
  }, [
    keyInput,
    pushMessage,
    models,
    selectedModelId,
    ready,
    settingsCwd,
    syncSessionModel,
    refreshSessionList,
  ])

  /** 发送消息 */
  const onSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || !ready || status === 'generating') return
    setInput('')
    setError(null)
    discardTypewriter()
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
            cwd: workspaceCwd || undefined,
          },
          ...prev,
        ]
      })
    }
    // 乐观展示用户气泡，并带上随机生成的 promptId
    const promptId = crypto.randomUUID()
    pushMessage('user', text, false, promptId)
    streamingRole.current = null

    // 30 秒兜底超时清理
    const timeoutId = setTimeout(() => {
      pendingPromptIds.current.delete(promptId)
    }, 30000)
    pendingPromptIds.current.set(promptId, timeoutId)

    try {
      await invoke('send_prompt', { text, promptId })
    } catch (e) {
      const t = pendingPromptIds.current.get(promptId)
      if (t) clearTimeout(t)
      pendingPromptIds.current.delete(promptId)
      setMessages((prev) => prev.filter((m) => m.promptId !== promptId))
      setInput(text)
      const msg = String(e)
      setError(msg)
      pushMessage('system', `发送失败: ${msg}`)
    }
  }

  /** 取消生成 */
  const onCancel = async () => {
    try {
      // 先冲刷已缓冲文字再取消，避免未展示内容丢失；后端 cancel 后 turn_ended 也会再 flush
      flushTypewriterNow()
      await invoke('cancel_turn')
    } catch (e) {
      setError(String(e))
    }
  }

  /** 回答权限选项 */
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

  /** 删除指定历史会话（当前会话由后端释放后自动开新会话，勿再调 New chat） */
  const handleDeleteChat = useCallback(
    async (id: string, sessionCwd?: string) => {
      if (!inTauri || starting || loadingSession) return
      const deletingActive = id === activeChatId
      const fromList = recentChats.find((c) => c.id === id)

      // 乐观从侧栏移除
      setRecentChats((prev) => prev.filter((c) => c.id !== id))

      if (deletingActive) {
        discardTypewriter()
        streamingRole.current = null
        setMessages([])
        setContextUsedTokens(0)
        setPermissionQueue([])
        setError(null)
        setReady(false)
        setStarting(true)
      }

      try {
        const fallbackCwd = await invoke<string>('workspace_cwd')
        const cwd = (sessionCwd || fromList?.cwd || fallbackCwd).trim() || fallbackCwd
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
    [inTauri, starting, loadingSession, activeChatId, recentChats, refreshSessionList, discardTypewriter],
  )

  /** 重命名历史会话标题（写入官方 summary.json） */
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
      // 乐观更新侧栏（Header 依赖 recentChats 标题）
      setRecentChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: next } : c)),
      )
      void refreshSessionList()
    },
    [inTauri, recentChats, refreshSessionList],
  )

  // starting 时静默重建：界面仍像空对话，但禁止发送打到旧引擎
  const canSend =
    inTauri &&
    ready &&
    !starting &&
    !loadingSession &&
    status !== 'generating' &&
    status !== 'initializing'

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
    <ArtifactProvider workspaceRoot={workspaceCwd}>
      <div className="app-container">
      {/* 左侧边栏组件 */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onNewChat={handleNewChat}
        onOpenSettings={() => void openSettings()}
        recentChats={recentChats}
        activeChatId={activeChatId}
        currentWorkspaceCwd={workspaceCwd}
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
          chatTitle={chatTitle}
        />

        {error && <div className="banner error">{error}</div>}

        {/* 消息列表组件 */}
        <MessageList
          messages={messages}
          permission={permission}
          loadingSession={loadingSession}
          sessionKey={activeChatId}
          streaming={status === 'generating'}
        />

        {/* 悬浮 Composer 输入框组件 */}
        <Composer
          ref={composerRef}
          input={input}
          setInput={setInput}
          canSend={canSend}
          isGenerating={status === 'generating'}
          ready={ready}
          starting={starting || loadingSession}
          models={models}
          selectedModelId={selectedModelId}
          reasoningEffort={reasoningEffort}
          workspaceCwd={workspaceCwd}
          workspaceOptions={workspaceOptions}
          contextUsedTokens={contextUsedTokens}
          canSwitchWorkspace={canSwitchWorkspace}
          onSwitchModel={(id) => void switchCurrentModel(id)}
          onSwitchReasoningEffort={(e) => void switchReasoningEffort(e)}
          onSelectWorkspace={(cwd) => void applyWorkspaceCwd(cwd)}
          onBrowseWorkspace={() => void browseWorkspace()}
          onSend={(text) => void onSend(text)}
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
            canSwitchWorkspace={canSwitchWorkspace}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
          />
        )}
      </div>
      <ArtifactPanel />
    </div>
    </ArtifactProvider>
  )
}
