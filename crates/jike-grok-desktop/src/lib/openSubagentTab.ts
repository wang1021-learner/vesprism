/**
 * 在新 tab 中打开子 agent 的 child session（磁盘投影 + load_session）。
 */
import {
  $activeTabId,
  $workspaceCwd,
  createTab,
  findTabBySessionId,
  getTabState,
  looksAbsolutePath,
  patchTab,
  resolveWorkspaceCwd,
  switchTab,
} from '../store'
import {
  getSessionMessages,
  loadSession,
  openTab,
} from '../bridge'
import {
  abortOpenSession,
  beginAttachRuntime,
  cacheSessionMessages,
  finishAttachRuntime,
  hydrateFromSnapshot,
  invalidateSessionMessages,
  nextLoadGen,
  currentLoadGen,
} from './sessionOpen'
import type { ChatMessage } from '../types'
import { generateId } from './generateId'

type DisplayMsg = {
  id: string
  role: string
  text: string
  tool?: string | null
  tool_call_id?: string | null
  prompt_id?: string | null
  kind?: string | null
  status?: string | null
  detail?: string | null
  preview?: string | null
  start_ms?: number | null
  end_ms?: number | null
}

function hydrateDisplayMessage(m: DisplayMsg): ChatMessage {
  const role = (m.role || 'assistant') as ChatMessage['role']
  if (role === 'tool' || m.tool_call_id || m.kind) {
    const toolCallId = m.tool_call_id || m.id || generateId('tool_')
    return {
      id: m.id || generateId('msg_'),
      role: 'tool',
      text: m.preview || m.detail || m.text || m.tool || '',
      tool: m.tool || m.kind || undefined,
      toolCallId,
      toolCall: {
        toolCallId,
        kind: m.kind || 'other',
        status: m.status || 'completed',
        title: m.tool || m.kind || 'tool',
        detail: m.detail || '',
        preview: m.preview || m.text || '',
        timing:
          m.start_ms != null
            ? { start: m.start_ms, ...(m.end_ms != null ? { end: m.end_ms } : {}) }
            : undefined,
      },
    }
  }
  return {
    id: m.id || generateId('msg_'),
    role:
      role === 'user' ||
      role === 'assistant' ||
      role === 'thought' ||
      role === 'system'
        ? role
        : 'assistant',
    text: m.text || '',
    promptId: m.prompt_id || undefined,
  }
}

export type OpenSubagentTabOpts = {
  title?: string
  cwd?: string
  /** 打开后是否切到子 Tab。自动弹出时默认 false，留在父会话看进展 */
  activate?: boolean
}

function mapDisplayMessages(
  raw: Array<{
    id: string
    role: string
    text: string
    tool?: string | null
    tool_call_id?: string | null
    prompt_id?: string | null
    kind?: string | null
    status?: string | null
    detail?: string | null
    preview?: string | null
    start_ms?: number | null
    end_ms?: number | null
  }>,
): ChatMessage[] {
  return raw.map((m) => hydrateDisplayMessage(m))
}

/**
 * 从磁盘重拉子会话消息写入已打开的 Tab。
 * 子 Agent 在父进程里跑，子 Tab 不会收到实时 chunk；结束/进度时需主动刷新。
 */
export async function refreshSubagentTabMessages(
  childSessionId: string,
  opts?: { outputFallback?: string | null },
): Promise<boolean> {
  const sid = childSessionId.trim()
  if (!sid) return false
  const tabId = findTabBySessionId(sid)
  if (!tabId) return false

  try {
    const raw = await getSessionMessages(sid)
    let messages = mapDisplayMessages(raw)
    const hasAssistant = messages.some(
      (m) => m.role === 'assistant' && (m.text || '').trim().length > 0,
    )
    const fallback = (opts?.outputFallback || '').trim()
    // 磁盘投影尚无助手气泡时，用 finished 事件里的 output 兜底
    if (!hasAssistant && fallback) {
      messages = [
        ...messages,
        {
          id: generateId('msg_'),
          role: 'assistant',
          text: fallback,
        },
      ]
    }
    invalidateSessionMessages(sid)
    cacheSessionMessages(sid, messages)
    patchTab(tabId, { messages, error: '' })
    return true
  } catch {
    // 仅有 output 时也尽量展示
    const fallback = (opts?.outputFallback || '').trim()
    if (fallback) {
      const prev = getTabState(tabId)?.messages ?? []
      const hasAssistant = prev.some(
        (m) => m.role === 'assistant' && (m.text || '').trim().length > 0,
      )
      if (!hasAssistant) {
        patchTab(tabId, {
          messages: [
            ...prev,
            { id: generateId('msg_'), role: 'assistant', text: fallback },
          ],
        })
        return true
      }
    }
    return false
  }
}

/**
 * 打开子 agent 的 child session 到新 tab。
 * 已打开则复用；失败时关闭新建 tab 并尽量切回父 tab。
 */
export async function openSubagentTab(
  childSessionId: string,
  opts?: OpenSubagentTabOpts,
): Promise<string | null> {
  const sid = childSessionId.trim()
  if (!sid) return null

  const existing = findTabBySessionId(sid)
  if (existing) {
    // 复用时重拉消息（可能刚跑完，比打开时多了回复）
    void refreshSubagentTabMessages(sid)
    if (opts?.activate !== false) switchTab(existing)
    return existing
  }

  const parentTab = $activeTabId.get()
  const parentState = parentTab ? getTabState(parentTab) : undefined
  const cwd = (
    opts?.cwd ||
    parentState?.cwd ||
    resolveWorkspaceCwd() ||
    $workspaceCwd.get() ||
    ''
  ).trim()
  if (!cwd || !looksAbsolutePath(cwd)) return null

  const activate = opts?.activate !== false
  const title = (opts?.title || '').trim() || `子任务 · ${sid.slice(0, 8)}`

  let tabId: string | null = null
  try {
    tabId = await openTab()
    createTab(tabId, {
      cwd,
      chatTitle: title,
      chatId: sid,
      // viewer 语义：模型由引擎按子会话实际配置驱动，前端不预写（避免显示误导）
      phase: 'loading',
      status: 'initializing',
    })
    if (activate) {
      switchTab(tabId)
    } else if (parentTab && getTabState(parentTab)) {
      // 后台开 Tab：保持父 Tab 为活跃
      switchTab(parentTab)
    }

    const gen = nextLoadGen(tabId)
    patchTab(tabId, { messages: [], phase: 'loading', status: 'initializing' })

    // 子会话刚 spawn 时磁盘可能只有 user 提示；回复靠后续 refresh
    try {
      const raw = await getSessionMessages(sid)
      if (gen !== currentLoadGen(tabId)) return tabId
      const messages = mapDisplayMessages(raw)
      cacheSessionMessages(sid, messages)
      if (messages.length) hydrateFromSnapshot(messages, tabId)
    } catch {
      /* 空子会话稍后 refresh */
    }

    beginAttachRuntime(tabId)
    await loadSession(tabId, sid, cwd)
    if (gen !== currentLoadGen(tabId)) return tabId
    finishAttachRuntime(tabId)
    patchTab(tabId, {
      sessionId: sid,
      chatId: sid,
      phase: 'ready',
      status: 'idle',
      error: '',
    })
    // attach 后再拉一次：子 agent 可能已开始写
    void refreshSubagentTabMessages(sid)
    if (!activate && parentTab && getTabState(parentTab)) {
      switchTab(parentTab)
    }
    return tabId
  } catch (e) {
    const err = String(e)
    if (tabId) {
      // 官方 viewer 语义：attach 失败保留 tab 作只读投影（已拉到的磁盘消息可见），
      // 不关窗口；错误写进该 tab，用户可自行关闭或稍后重试
      abortOpenSession(tabId)
      patchTab(tabId, {
        phase: 'ready',
        status: 'idle',
        error: `打开子会话失败: ${err}`,
      })
      void refreshSubagentTabMessages(sid)
    }
    if (parentTab && getTabState(parentTab)) {
      switchTab(parentTab)
      if (activate) {
        patchTab(parentTab, { error: `打开子会话失败: ${err}` })
      }
    }
    return null
  }
}
