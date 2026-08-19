import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab, getTabState, patchTab, removeTab } from '../store'

const cancelTurn = vi.fn().mockResolvedValue(undefined)
const respondPermission = vi.fn().mockResolvedValue(undefined)
vi.mock('../bridge', () => ({
  cancelTurn: (...a: unknown[]) => cancelTurn(...a),
  respondPermission: (...a: unknown[]) => respondPermission(...a),
}))

const { cancelActiveTurn } = await import('./cancelActiveTurn')

describe('cancelActiveTurn', () => {
  beforeEach(() => {
    cancelTurn.mockClear()
    respondPermission.mockClear()
    removeTab('tab-1')
    createTab('tab-1', { modelId: 'm', status: 'generating' })
  })

  it('无权限时只 cancel，并把状态置 idle', async () => {
    await cancelActiveTurn('tab-1')
    expect(respondPermission).not.toHaveBeenCalled()
    expect(cancelTurn).toHaveBeenCalledWith('tab-1')
    expect(getTabState('tab-1')?.status).toBe('idle')
    expect(getTabState('tab-1')?.permission).toBeNull()
  })

  it('有挂起权限时先拒绝再 cancel，避免引擎干等', async () => {
    patchTab('tab-1', {
      permission: {
        id: '7',
        tool: 'search_replace',
        options: [
          { id: 'opt-allow', name: '允许', kind: 'allow' },
          { id: 'opt-deny', name: '拒绝', kind: 'deny' },
        ],
      },
    })
    await cancelActiveTurn('tab-1')
    expect(respondPermission).toHaveBeenCalledWith('tab-1', 7, 'opt-deny')
    expect(cancelTurn).toHaveBeenCalledWith('tab-1')
    expect(getTabState('tab-1')?.permission).toBeNull()
    expect(getTabState('tab-1')?.status).toBe('idle')
  })

  it('队列里还有条目时保持 generating，让下一则继续跑', async () => {
    patchTab('tab-1', {
      queuedPrompts: [{ id: 'q1', version: 0, text: 'next', position: 0 }],
    })
    await cancelActiveTurn('tab-1')
    expect(getTabState('tab-1')?.status).toBe('generating')
  })
})
