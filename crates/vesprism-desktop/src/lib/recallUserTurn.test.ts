import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $activeTabId,
  createTab,
  getTabState,
  patchTab,
  resetTabsForTests,
  switchTab,
} from '../store'
import type { ChatMessage } from '../types'

const executeRewind = vi.fn()
const loadSession = vi.fn().mockResolvedValue(undefined)
vi.mock('../bridge', () => ({
  executeRewind: (...a: unknown[]) => executeRewind(...a),
  loadSession: (...a: unknown[]) => loadSession(...a),
}))

const { recallUserTurn } = await import('./recallUserTurn')

function msg(id: string, role: ChatMessage['role'], text = ''): ChatMessage {
  return { id, role, text }
}

const twoTurns: ChatMessage[] = [
  msg('u1', 'user', '第一问'),
  msg('a1', 'assistant', '第一答'),
  msg('u2', 'user', '/memory'),
  msg('a2', 'assistant', '记忆面板'),
]

describe('recallUserTurn', () => {
  beforeEach(() => {
    resetTabsForTests()
    executeRewind.mockReset()
    loadSession.mockReset().mockResolvedValue(undefined)
    executeRewind.mockResolvedValue({
      success: true,
      target_prompt_index: 1,
      mode: 'conversation_only',
      reverted_files: [],
      clean_files: [],
      conflicts: [],
    })
    createTab('tab-1', {
      sessionId: 'sid',
      cwd: '/ws',
      status: 'idle',
      phase: 'ready',
      messages: twoTurns,
    })
    switchTab('tab-1')
  })

  it('最新提问：回滚对话、填回输入框、不重发', async () => {
    await recallUserTurn('u2')
    expect(executeRewind).toHaveBeenCalledWith(
      'tab-1',
      1,
      'conversation_only',
      true,
    )
    expect(loadSession).toHaveBeenCalledWith('tab-1', 'sid', '/ws', false, 'medium')
    expect(getTabState('tab-1')?.composerInput).toBe('/memory')
    expect(getTabState('tab-1')?.status).toBe('idle')
  })

  it('更早的提问不可撤回', async () => {
    await recallUserTurn('u1')
    expect(executeRewind).not.toHaveBeenCalled()
    expect(getTabState('tab-1')?.composerInput).toBe('')
  })

  it('生成中不可撤回', async () => {
    patchTab('tab-1', { status: 'generating' })
    await recallUserTurn('u2')
    expect(executeRewind).not.toHaveBeenCalled()
  })

  it('没有活跃 tab 时不调引擎', async () => {
    $activeTabId.set('')
    await recallUserTurn('u2')
    expect(executeRewind).not.toHaveBeenCalled()
  })
})
