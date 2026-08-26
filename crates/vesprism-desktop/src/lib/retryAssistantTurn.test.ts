import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTab,
  getTabState,
  resetTabsForTests,
  switchTab,
} from '../store'
import type { ChatMessage } from '../types'

const executeRewind = vi.fn()
const loadSession = vi.fn()
const sendPrompt = vi.fn()

vi.mock('../bridge', () => ({
  executeRewind: (...a: unknown[]) => executeRewind(...a),
  loadSession: (...a: unknown[]) => loadSession(...a),
  sendPrompt: (...a: unknown[]) => sendPrompt(...a),
  interjectPrompt: vi.fn(),
}))

const { retryAssistantTurn } = await import('./retryAssistantTurn')

function msg(
  id: string,
  role: ChatMessage['role'],
  text = '',
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id, role, text, ...extra }
}

describe('retryAssistantTurn', () => {
  beforeEach(() => {
    resetTabsForTests()
    executeRewind.mockReset().mockResolvedValue({
      success: true,
      target_prompt_index: 0,
      mode: 'conversation_only',
      reverted_files: [],
      clean_files: [],
      conflicts: [],
    })
    loadSession.mockReset().mockResolvedValue('D:\\ws')
    sendPrompt.mockReset().mockResolvedValue(undefined)
    createTab('tab-1', {
      sessionId: 'sid',
      cwd: 'D:\\ws',
      status: 'idle',
      phase: 'ready',
      messages: [
        msg('u1', 'user', '这是什么', {
          attachments: [{ kind: 'image', path: 'C:\\tmp\\a.png' }],
        }),
        msg('a1', 'assistant', '设置图标'),
      ],
    })
    switchTab('tab-1')
  })

  it('必须 force 执行回滚，不能走预演', async () => {
    await retryAssistantTurn('a1')
    expect(executeRewind).toHaveBeenCalledWith(
      'tab-1',
      0,
      'conversation_only',
      true,
    )
  })

  it('预演失败（success=false 且无 error）时不要只显示「重试失败」就停', async () => {
    executeRewind.mockResolvedValueOnce({
      success: false,
      target_prompt_index: 0,
      mode: 'conversation_only',
      reverted_files: [],
      clean_files: [],
      conflicts: [],
    })
    await retryAssistantTurn('a1')
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('成功后去掉旧回复，并带上原图重发', async () => {
    await retryAssistantTurn('a1')
    const st = getTabState('tab-1')
    expect(st?.messages.map((m) => m.id)).toEqual(['u1'])
    expect(sendPrompt).toHaveBeenCalled()
    const args = sendPrompt.mock.calls[0]
    expect(args[1]).toBe('这是什么')
    expect(args[3]).toEqual([
      { kind: 'image', path: 'C:\\tmp\\a.png', previewUrl: undefined },
    ])
  })
})
