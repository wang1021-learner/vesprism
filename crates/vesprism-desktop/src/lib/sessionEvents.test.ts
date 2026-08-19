/**
 * turn_ended：队列空必须显式 idle，避免后端漏发 status_changed 时取消按钮卡住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bridge', () => ({
  loadSession: vi.fn(),
  respondPermission: vi.fn(),
  setCurrentModel: vi.fn(),
  startSession: vi.fn(),
}))

import { handleSessionEvent } from './sessionEvents'
import { createTab, getTabState, patchTab, resetTabsForTests } from '../store'

beforeEach(() => {
  resetTabsForTests()
  createTab('tab-1', {
    status: 'generating',
    permission: { requestId: 1, command: 'ls' } as never,
    messages: [{ id: 'm1', role: 'user', text: 'hi', promptId: 'p1' } as never],
  })
})

describe('turn_ended status', () => {
  it('队列空：本轮结束置 idle，并清权限条', () => {
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    const st = getTabState('tab-1')
    expect(st?.status).toBe('idle')
    expect(st?.permission).toBeNull()
  })

  it('队列还有货：保持 generating', () => {
    patchTab('tab-1', {
      queuedPrompts: [{ id: 'p2', version: 0, text: 'next', position: 0 }],
    })
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    expect(getTabState('tab-1')?.status).toBe('generating')
  })

  it('迟到的旧回合：不改下一轮状态和权限条', () => {
    patchTab('tab-1', {
      status: 'generating',
      permission: { requestId: 9, command: 'pwd' } as never,
      messages: [
        { id: 'm1', role: 'user', text: 'old', promptId: 'p1' } as never,
        { id: 'm2', role: 'user', text: 'new', promptId: 'p2' } as never,
      ],
    })
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    const st = getTabState('tab-1')
    expect(st?.status).toBe('generating')
    expect(st?.permission).not.toBeNull()
  })
})
