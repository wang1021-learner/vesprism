/**
 * 在新 tab 中打开子 agent 的 child session（磁盘投影 + load_session）。
 */
import {
  $activeTabId,
  $workspaceCwd,
  createTab,
  getTabState,
  patchTab,
  removeTab,
  switchTab,
} from '../store'
import {
  closeTab,
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

/**
 * 打开子 agent 的 child session 到新 tab。
 * 失败时关闭新建 tab 并切回父 tab。
 */
export async function openSubagentTab(
  childSessionId: string,
  opts?: { title?: string; cwd?: string },
): Promise<string | null> {
  const sid = childSessionId.trim()
  if (!sid) return null

  const parentTab = $activeTabId.get()
  const parentState = parentTab ? getTabState(parentTab) : undefined
  const cwd =
    (opts?.cwd || parentState?.cwd || $workspaceCwd.get() || '').trim()
  if (!cwd) return null

  let tabId: string | null = null
  try {
    tabId = await openTab()
    createTab(tabId, {
      cwd,
      chatTitle: opts?.title || `子任务 · ${sid.slice(0, 8)}`,
      chatId: sid,
      modelId: parentState?.modelId || '',
      reasoningEffort: parentState?.reasoningEffort || 'medium',
    })
    switchTab(tabId)

    const gen = nextLoadGen(tabId)
    patchTab(tabId, { messages: [], phase: 'loading', status: 'initializing' })

    const raw = await getSessionMessages(sid)
    if (gen !== currentLoadGen(tabId)) return tabId
    const messages = raw.map((m) => hydrateDisplayMessage(m))
    cacheSessionMessages(sid, messages)
    hydrateFromSnapshot(messages, tabId)

    beginAttachRuntime(tabId)
    await loadSession(tabId, sid, cwd)
    if (gen !== currentLoadGen(tabId)) return tabId
    finishAttachRuntime(tabId)
    patchTab(tabId, { sessionId: sid, chatId: sid, phase: 'ready', status: 'idle' })
    return tabId
  } catch (e) {
    const err = String(e)
    if (tabId) {
      abortOpenSession(tabId)
      try {
        await closeTab(tabId)
      } catch {
        /* 后端可能尚未登记成功 */
      }
      removeTab(tabId)
    }
    if (parentTab && getTabState(parentTab)) {
      switchTab(parentTab)
      patchTab(parentTab, { error: `打开子会话失败: ${err}` })
    }
    return null
  }
}
