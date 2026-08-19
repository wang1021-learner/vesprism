import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $scratchCwd,
  createTab,
  getTabState,
  patchTab,
  resetTabsForTests,
} from '../store'
import type { WorkbenchBinding } from '../workbench/bindings'

const getSessionMessages = vi.fn()
const loadSession = vi.fn().mockResolvedValue(undefined)
const openTab = vi.fn().mockResolvedValue('tab-new')
const requestFlowFocus = vi.fn()
const requestAgentsFocus = vi.fn()

vi.mock('../bridge', () => ({
  getSessionMessages: (...a: unknown[]) => getSessionMessages(...a),
  loadSession: (...a: unknown[]) => loadSession(...a),
  openTab: (...a: unknown[]) => openTab(...a),
}))

vi.mock('../workbench/flow/focus', () => ({
  requestFlowFocus: (...a: unknown[]) => requestFlowFocus(...a),
}))

vi.mock('../workbench/agents/focus', () => ({
  requestAgentsFocus: (...a: unknown[]) => requestAgentsFocus(...a),
}))

vi.mock('./reconcileRunningSubagents', () => ({
  reconcileRunningSubagents: vi.fn(),
}))

const { openWorkbenchHistory } = await import('./openWorkbenchSession')

function flowBinding(sessionId = 'sess-1'): WorkbenchBinding {
  return {
    session_id: sessionId,
    artifacts: [{ kind: 'flow', id: 'demo-linear' }],
    updated_at_ms: 1,
  }
}

describe('openWorkbenchHistory', () => {
  beforeEach(() => {
    resetTabsForTests()
    $scratchCwd.set('C:\\\\scratch')
    getSessionMessages.mockReset()
    loadSession.mockClear()
    openTab.mockClear()
    requestFlowFocus.mockClear()
    requestAgentsFocus.mockClear()
    getSessionMessages.mockResolvedValue([
      { id: 'm1', role: 'user', text: '你根据他的agent配置一个agent' },
      { id: 'm2', role: 'assistant', text: '好的，已按 agent.vue 配好。' },
    ])
  })

  it('切到已打开的画布 Tab 时仍会 loadSession，并灌入历史消息', async () => {
    createTab('tab-flow', {
      utilityKind: 'flow-canvas',
      sessionId: 'sess-other',
      chatTitle: '流程画布',
      cwd: 'C:\\\\scratch',
      messages: [],
    })
    const tabId = await openWorkbenchHistory({
      sessionId: 'sess-1',
      binding: flowBinding(),
      title: '你根据他的agent配置一个agent',
      cwd: 'C:\\\\scratch',
    })
    expect(tabId).toBe('tab-flow')
    expect(requestFlowFocus).toHaveBeenCalledWith('demo-linear')
    expect(getSessionMessages).toHaveBeenCalledWith('sess-1')
    expect(loadSession).toHaveBeenCalledWith('tab-flow', 'sess-1', 'C:\\\\scratch')
    const st = getTabState('tab-flow')
    expect(st?.sessionId).toBe('sess-1')
    expect(st?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(st?.messages[0]?.text).toContain('agent')
    expect(st?.chatTitle).toBe('你根据他的agent配置一个agent')
  })

  it('已经挂着同一会话时只切 Tab，不再重载', async () => {
    createTab('tab-flow', {
      utilityKind: 'flow-canvas',
      sessionId: 'sess-1',
      chatId: 'sess-1',
      chatTitle: '旧标题',
      cwd: 'C:\\\\scratch',
    })
    await openWorkbenchHistory({
      sessionId: 'sess-1',
      binding: flowBinding(),
      title: '你根据他的agent配置一个agent',
      cwd: 'C:\\\\scratch',
    })
    expect(requestFlowFocus).toHaveBeenCalledWith('demo-linear')
    expect(loadSession).not.toHaveBeenCalled()
    expect(getTabState('tab-flow')?.chatTitle).toBe('你根据他的agent配置一个agent')
  })

  it('没有画布 Tab 时先开专用 Tab 再 loadSession', async () => {
    const tabId = await openWorkbenchHistory({
      sessionId: 'sess-1',
      binding: flowBinding(),
      title: '配置催收 Agent',
      cwd: 'C:\\\\scratch',
    })
    expect(openTab).toHaveBeenCalled()
    expect(tabId).toBe('tab-new')
    expect(loadSession).toHaveBeenCalledWith('tab-new', 'sess-1', 'C:\\\\scratch')
    expect(getTabState('tab-new')?.utilityKind).toBe('flow-canvas')
  })
})
