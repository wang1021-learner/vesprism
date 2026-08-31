import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab, getTabState, patchTab, resetTabsForTests } from '../store'

const removeQueuedPrompt = vi.fn()
const editQueuedPrompt = vi.fn()
const reorderQueuedPrompts = vi.fn()
const clearQueuedPrompts = vi.fn()
const interjectQueuedPrompt = vi.fn()
const holdQueuedEdit = vi.fn()
const releaseQueuedEdit = vi.fn()

vi.mock('../bridge', () => ({
  removeQueuedPrompt: (...a: unknown[]) => removeQueuedPrompt(...a),
  editQueuedPrompt: (...a: unknown[]) => editQueuedPrompt(...a),
  reorderQueuedPrompts: (...a: unknown[]) => reorderQueuedPrompts(...a),
  clearQueuedPrompts: (...a: unknown[]) => clearQueuedPrompts(...a),
  interjectQueuedPrompt: (...a: unknown[]) => interjectQueuedPrompt(...a),
  holdQueuedEdit: (...a: unknown[]) => holdQueuedEdit(...a),
  releaseQueuedEdit: (...a: unknown[]) => releaseQueuedEdit(...a),
}))

const { queuedPromptActions } = await import('./useQueuedPromptActions')

function acts(tabId = 'tab-1') {
  return queuedPromptActions(tabId)
}

describe('queuedPromptActions', () => {
  beforeEach(() => {
    resetTabsForTests()
    createTab('tab-1', {
      queuedPrompts: [
        { id: 'a', version: 0, text: 'one', position: 0 },
        { id: 'b', version: 1, text: 'two', position: 1 },
      ],
    })
    removeQueuedPrompt.mockReset().mockResolvedValue(undefined)
    editQueuedPrompt.mockReset().mockResolvedValue(undefined)
    reorderQueuedPrompts.mockReset().mockResolvedValue(undefined)
    clearQueuedPrompts.mockReset().mockResolvedValue(undefined)
    interjectQueuedPrompt.mockReset().mockResolvedValue(undefined)
    holdQueuedEdit.mockReset().mockResolvedValue(undefined)
    releaseQueuedEdit.mockReset().mockResolvedValue(undefined)
  })

  it('重排先乐观改序，再把 id 列表发给引擎', async () => {
    await acts().onReorderQueued('b', -1)
    expect(getTabState('tab-1')?.queuedPrompts.map((q) => q.id)).toEqual(['b', 'a'])
    expect(reorderQueuedPrompts).toHaveBeenCalledWith('tab-1', ['b', 'a'])
  })

  it('重排失败回滚', async () => {
    reorderQueuedPrompts.mockRejectedValueOnce(new Error('nope'))
    await acts().onReorderQueued('b', -1)
    expect(getTabState('tab-1')?.queuedPrompts.map((q) => q.id)).toEqual(['a', 'b'])
  })

  it('立刻发送乐观移出队列', async () => {
    await acts().onSendQueuedNow('a', 0)
    expect(getTabState('tab-1')?.queuedPrompts.map((q) => q.id)).toEqual(['b'])
    expect(interjectQueuedPrompt).toHaveBeenCalledWith('tab-1', 'a', 0)
  })

  it('清空乐观清空，失败还原', async () => {
    await acts().onClearQueued()
    expect(getTabState('tab-1')?.queuedPrompts).toEqual([])
    expect(clearQueuedPrompts).toHaveBeenCalledWith('tab-1')
    patchTab('tab-1', {
      queuedPrompts: [
        { id: 'a', version: 0, text: 'one', position: 0 },
      ],
    })
    clearQueuedPrompts.mockRejectedValueOnce(new Error('fail'))
    await acts().onClearQueued()
    expect(getTabState('tab-1')?.queuedPrompts.map((q) => q.id)).toEqual(['a'])
  })
})
