/**
 * Tauri IPC — 严格对齐 Rust commands.rs。
 * 仅在桌面 WebView（有 __TAURI__ / __TAURI_INTERNALS__）中可用。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ModelInfo } from './types'

/** 是否运行在 Tauri 桌面壳内（而非普通浏览器） */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
  }
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

// ── Tab 生命周期 ──
export const openTab = () => invoke<string>('open_tab')
export const closeTab = (tabId: string) => invoke('close_tab', { tabId })
export const restartTab = (tabId: string) => invoke('restart_tab', { tabId })

// ── 工作区 ──
export const workspaceCwd = () => invoke<string>('workspace_cwd')
export const setWorkspaceCwd = (cwd: string) => invoke<string>('set_workspace_cwd', { cwd })

// ── 会话 ──
export const startSession = (tabId: string, cwd: string) => invoke('start_session', { tabId, cwd })
export const sendPrompt = (tabId: string, text: string, promptId?: string) =>
  invoke('send_prompt', { tabId, text, promptId: promptId ?? crypto.randomUUID() })
export const cancelTurn = (tabId: string) => invoke('cancel_turn', { tabId })
export const restartSession = (tabId: string, cwd: string) => invoke('restart_session', { tabId, cwd })

// ── 会话列表 (threads 索引；含 preview) ──
export const listSessions = (cwd: string, limit?: number) =>
  invoke<
    Array<{
      id: string
      title: string
      updated_at: string
      cwd: string
      num_messages?: number
      preview?: string
    }>
  >('list_sessions', {
    cwd,
    limit: limit ?? null,
  })

/** 官方 FTS 搜索会话（标题 + 用户消息）；首次可能 bootstrapping */
export const searchSessions = (
  query: string,
  cwd?: string | null,
  limit?: number,
) =>
  invoke<{
    results: Array<{
      id: string
      title: string
      cwd: string
      updated_at: string
      score: number
      snippet?: string | null
      matched_fields: string[]
    }>
    bootstrapping: boolean
    total_estimate?: number | null
  }>('search_sessions', {
    query,
    cwd: cwd ?? null,
    limit: limit ?? 50,
  })

/** 只读磁盘 transcript 投影消息（不启 agent）— 打开历史主路径 */
export const getSessionMessages = (sessionId: string) =>
  invoke<
    Array<{
      id: string
      role: string
      text: string
      tool?: string | null
      tool_call_id?: string | null
      prompt_id?: string | null
      /** read / edit / execute / search / … */
      kind?: string | null
      status?: string | null
      detail?: string | null
      preview?: string | null
    }>
  >('get_session_messages', { sessionId })

export const loadSession = (tabId: string, sessionId: string, cwd: string) =>
  invoke('load_session', { tabId, sessionId, cwd })

export const deleteSession = (tabId: string, sessionId: string, cwd: string) =>
  invoke('delete_session', { tabId, sessionId, cwd })

export const renameSession = (sessionId: string, cwd: string, title: string) =>
  invoke('rename_session', { sessionId, cwd, title })

// ── 模型 ──
export const setCurrentModel = (tabId: string, modelId: string, reasoningEffort?: string) =>
  invoke('set_current_model', { tabId, modelId, reasoningEffort: reasoningEffort ?? null })

export const getModelSettings = () =>
  invoke<{ default_id: string; models: ModelInfo[]; config_path: string }>('get_model_settings')

export const saveModelSettings = (defaultId: string, models: ModelInfo[]) =>
  invoke('save_model_settings', { defaultId, models })

export const reloadModels = (tabId: string) => invoke('reload_models', { tabId })

// ── 权限 ──
export const respondPermission = (tabId: string, requestId: number, optionId: string) =>
  invoke('respond_permission', { tabId, requestId, optionId })

// ── 密钥 ──
export const getEnvStatus = (keyName: string) =>
  invoke<{ key_name: string; is_set: boolean }>('get_env_status', { keyName })

export const saveEnvKey = (keyName: string, value: string) =>
  invoke('save_env_key', { keyName, value })

export const envFileLocation = () => invoke<string>('env_file_location')

// ── 文件 ──
export const readFileForPreview = (path: string, workspaceRoot: string) =>
  invoke<string>('read_file_for_preview', { path, workspaceRoot })

export const listDir = (path: string) =>
  invoke<Array<{ name: string; is_dir: boolean }>>('list_dir', { path })

export const readFileText = (path: string) =>
  invoke<string>('read_file_text', { path })

export const pickDirectory = () => invoke<string | null>('pick_directory')

// ── 流式事件（与后端 FrontendEvent snake_case tag 对齐）──
export interface SessionEventPayload {
  type: string
  tab_id: string
  text?: string
  prompt_id?: string | null
  stop_reason?: string
  message?: string
  debug?: string
  /** ToolCallInfo camelCase */
  tool?: {
    toolCallId?: string
    kind?: string
    status?: string
    title?: string
    detail?: string
    preview?: string
    diffs?: unknown[]
    /** 兼容错误字段 */
    name?: string
    call_id?: string
    input?: Record<string, unknown>
  }
  /** ToolCallUpdateInfo camelCase */
  update?: {
    toolCallId?: string
    kind?: string | null
    status?: string | null
    title?: string | null
    detail?: string | null
    preview?: string | null
    diffs?: unknown[] | null
    call_id?: string
    output?: string
  }
  request_id?: number
  description?: string
  options?: { id: string; name: string; kind?: string }[]
  status?: string
  session_id?: string
  total_tokens?: number
  /** 会话标题更新（引擎 LLM 生成 / 手动改名） */
  title?: string
  /** TabActor 重建次数（tab_recovering） / 连续 panic 次数（tab_failed） */
  attempt?: number
  attempts?: number
}

let _unlisten: UnlistenFn | null = null

export async function listenSessionEvents(
  handler: (event: SessionEventPayload) => void
): Promise<() => void> {
  _unlisten?.()
  _unlisten = await listen<SessionEventPayload>('session-event', (e) => handler(e.payload))
  return () => {
    _unlisten?.()
    _unlisten = null
  }
}
