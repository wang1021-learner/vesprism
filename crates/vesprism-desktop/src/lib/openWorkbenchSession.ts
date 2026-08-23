/**
 * 侧栏「工作台」历史：定位 Flow/Agent 产物，并把该会话的聊天灌进专用 Tab。
 * 不能只 openChatTab 切面板——那会留下空消息列表。
 */
import {
  $scratchCwd,
  createTab,
  findTabByUtilityKind,
  getTabState,
  hasTab,
  looksAbsolutePath,
  patchTab,
  resolveNewTabCwd,
  resolveNewTabModel,
  switchTab,
  type UtilityKind,
} from '../store'
import { getSessionMessages, loadSession, openTab } from '../bridge'
import { mapDisplayMessages } from './openSubagentTab'
import { clearSessionAllowed } from './permissionMemory'
import { reconcileRunningSubagents } from './reconcileRunningSubagents'
import {
  abortOpenSession,
  beginAttachRuntime,
  cacheSessionMessages,
  currentLoadGen,
  finishAttachRuntime,
  getCachedSessionMessages,
  hydrateFromSnapshot,
  nextLoadGen,
} from './sessionOpen'
import { requestAgentsFocus } from '../workbench/agents/focus'
import type { WorkbenchBinding } from '../workbench/bindings'
import { requestFlowFocus } from '../workbench/flow/focus'

export type OpenWorkbenchHistoryOpts = {
  sessionId: string
  binding: WorkbenchBinding
  title?: string
  cwd?: string
}

function pickUtility(binding: WorkbenchBinding): {
  kind: UtilityKind
  fallbackTitle: string
} {
  const artifacts = [...binding.artifacts].reverse()
  if (artifacts.some((item) => item.kind === 'flow')) {
    return { kind: 'flow-canvas', fallbackTitle: '流程画布' }
  }
  if (artifacts.some((item) => item.kind === 'agent')) {
    return { kind: 'agents', fallbackTitle: 'Agent 编制' }
  }
  return { kind: 'flow-canvas', fallbackTitle: '流程画布' }
}

export async function openWorkbenchHistory(
  opts: OpenWorkbenchHistoryOpts,
): Promise<string | null> {
  const sessionId = opts.sessionId.trim()
  if (!sessionId) return null

  const artifacts = [...opts.binding.artifacts].reverse()
  const flow = artifacts.find((item) => item.kind === 'flow')
  const agent = artifacts.find((item) => item.kind === 'agent')
  if (flow) requestFlowFocus(flow.id)
  else if (agent) requestAgentsFocus(agent.id)

  const { kind, fallbackTitle } = pickUtility(opts.binding)
  const title = (opts.title || '').trim() || fallbackTitle
  const cwd = (opts.cwd || resolveNewTabCwd() || $scratchCwd.get() || '').trim()
  if (!cwd || !looksAbsolutePath(cwd)) return null

  let tabId = findTabByUtilityKind(kind)
  const existing = tabId ? getTabState(tabId) : undefined
  if (
    tabId &&
    existing &&
    (existing.sessionId === sessionId || existing.chatId === sessionId)
  ) {
    if (title && title !== fallbackTitle && existing.chatTitle !== title) {
      patchTab(tabId, { chatTitle: title })
    }
    switchTab(tabId)
    return tabId
  }

  if (tabId && existing?.sessionId) {
    const cur = existing.messages ?? []
    if (cur.length > 0) cacheSessionMessages(existing.sessionId, cur)
  }

  if (!tabId) {
    const model = resolveNewTabModel()
    tabId = await openTab()
    createTab(tabId, {
      cwd,
      chatTitle: title,
      chatId: sessionId,
      modelId: model.modelId,
      reasoningEffort: model.reasoningEffort,
      utilityKind: kind,
      phase: 'loading',
      status: 'initializing',
    })
  }

  const gen = nextLoadGen(tabId)
  try {
    patchTab(tabId, {
      messages: [],
      phase: 'loading',
      status: 'initializing',
      error: '',
      chatId: sessionId,
      chatTitle: title,
      cwd,
      utilityKind: kind,
      subagents: [],
      permission: null,
      userQuestion: null,
      mcpElicit: null,
      composerInput: '',
    })
    clearSessionAllowed(tabId)

    let messages = getCachedSessionMessages(sessionId)
    if (!messages) {
      const raw = await getSessionMessages(sessionId)
      if (gen !== currentLoadGen(tabId)) return tabId
      messages = mapDisplayMessages(raw)
      cacheSessionMessages(sessionId, messages)
    } else if (gen !== currentLoadGen(tabId)) {
      return tabId
    }

    hydrateFromSnapshot(messages, tabId)
    switchTab(tabId)

    beginAttachRuntime(tabId)
    await loadSession(tabId, sessionId, cwd)
    void reconcileRunningSubagents(tabId)
    if (gen !== currentLoadGen(tabId)) return tabId
    finishAttachRuntime(tabId)
    if (!hasTab(tabId)) return null
    patchTab(tabId, {
      sessionId,
      chatId: sessionId,
      phase: 'ready',
      status: 'idle',
      error: '',
      chatTitle: title,
      utilityKind: kind,
      cwd,
    })
    cacheSessionMessages(sessionId, getTabState(tabId)?.messages ?? messages)
    return tabId
  } catch (e) {
    if (gen !== currentLoadGen(tabId)) return tabId
    abortOpenSession(tabId)
    patchTab(tabId, { phase: 'ready', status: 'idle', error: String(e) })
    return tabId
  }
}
