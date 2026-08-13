/**
 * 关闭 Tab：最后一个空白新对话空操作；非最后立刻从列表移除，不阻塞等待 IPC。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $activeTabId,
  $tabs,
  createTab,
  getTabState,
  resetTabsForTests,
  switchTab,
} from '../store'

const closeTab = vi.fn().mockResolvedValue(undefined)
const restartSession = vi.fn().mockResolvedValue(undefined)
const startSession = vi.fn().mockResolvedValue(undefined)

vi.mock('../bridge', () => ({
  closeTab: (...a: unknown[]) => closeTab(...a),
  restartSession: (...a: unknown[]) => restartSession(...a),
  startSession: (...a: unknown[]) => startSession(...a),
}))

import { closeChatTab } from './closeChatTab'

beforeEach(() => {
  resetTabsForTests()
  closeTab.mockClear()
  restartSession.mockClear()
  startSession.mockClear()
})

describe('closeChatTab', () => {
  it('最后一个空白新对话：不关、不重建', () => {
    createTab('tab-1', { sessionId: 'engine-1', chatId: '', messages: [] })
    switchTab('tab-1')
    expect(closeChatTab('tab-1')).toBe(false)
    expect($tabs.get()).toHaveLength(1)
    expect(closeTab).not.toHaveBeenCalled()
    expect(restartSession).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('最后一个有内容的 tab：原地清空，不走 close+open', () => {
    createTab('tab-1', {
      chatId: 'chat-1',
      chatTitle: '旧对话',
      messages: [{ id: 'm1', role: 'user', text: 'hi' } as never],
      cwd: 'D:\\repo',
    })
    switchTab('tab-1')
    expect(closeChatTab('tab-1')).toBe(true)
    expect($tabs.get()).toHaveLength(1)
    expect($tabs.get()[0].id).toBe('tab-1')
    expect(getTabState('tab-1')?.chatId).toBe('')
    expect(getTabState('tab-1')?.messages).toEqual([])
    expect($tabs.get()[0].title).toBe('')
    expect(closeTab).not.toHaveBeenCalled()
    expect(restartSession).toHaveBeenCalledWith('tab-1', 'D:\\repo')
  })

  it('非最后一个：立刻从列表移除，closeTab 后台调用', () => {
    createTab('tab-1', { chatTitle: 'A' })
    createTab('tab-2', { chatTitle: '' })
    switchTab('tab-2')
    expect(closeChatTab('tab-2')).toBe(true)
    expect($tabs.get().map((t) => t.id)).toEqual(['tab-1'])
    expect($activeTabId.get()).toBe('tab-1')
    expect(getTabState('tab-2')).toBeUndefined()
    expect(closeTab).toHaveBeenCalledWith('tab-2')
  })
})
