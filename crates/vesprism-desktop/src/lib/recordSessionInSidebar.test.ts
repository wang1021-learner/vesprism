import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  preserveActiveLiveChat,
  recordLiveSession,
  upsertLiveChat,
} from './recordSessionInSidebar'
import {
  $activeTabId,
  $chats,
  createTab,
  getTabState,
  resetTabsForTests,
  switchTab,
} from '../store'

vi.mock('../workbench/bindings', () => ({
  touchWorkbenchSession: vi.fn(async () => {}),
}))

import { touchWorkbenchSession } from '../workbench/bindings'

describe('recordSessionInSidebar', () => {
  beforeEach(() => {
    resetTabsForTests()
    $chats.set([])
    vi.mocked(touchWorkbenchSession).mockClear()
  })

  it('编码会话写入侧栏并顶到最前', () => {
    upsertLiveChat({
      id: 's1',
      title: '修登录',
      cwd: 'D:/repo',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    upsertLiveChat({
      id: 's2',
      title: '第二句',
      cwd: 'D:/repo',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    upsertLiveChat({
      id: 's1',
      title: '修登录页',
      cwd: 'D:/repo',
      updatedAt: '2026-01-03T00:00:00.000Z',
    })
    expect($chats.get().map((c) => c.id)).toEqual(['s1', 's2'])
    expect($chats.get()[0]?.title).toBe('修登录页')
  })

  it('刷新列表时留住当前编码会话', () => {
    createTab('tab-1', {
      sessionId: 'sess-live',
      chatTitle: '刚发的',
      cwd: 'D:/repo',
    })
    switchTab('tab-1')
    $activeTabId.set('tab-1')
    $chats.set([
      {
        id: 'sess-live',
        title: '刚发的',
        cwd: 'D:/repo',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const listed = preserveActiveLiveChat([
      {
        id: 'older',
        title: '旧的',
        cwd: 'D:/repo',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    expect(listed.map((c) => c.id)).toEqual(['sess-live', 'older'])
  })

  it('编码发消息后侧栏有记录，并钉上 chatId', async () => {
    createTab('tab-1', { sessionId: 'sess-1', cwd: 'D:/repo' })
    await recordLiveSession('tab-1', '帮我改登录页')
    expect(getTabState('tab-1')?.chatId).toBe('sess-1')
    expect($chats.get()[0]).toMatchObject({ id: 'sess-1', title: '帮我改登录页' })
  })

  it('工作台发消息登记干活会话，不进编码列表', async () => {
    createTab('tab-flow', {
      utilityKind: 'flow-canvas',
      sessionId: 'sess-f',
      cwd: 'D:/repo',
    })
    await recordLiveSession('tab-flow', '画一个外呼流程')
    expect($chats.get()).toEqual([])
    expect(vi.mocked(touchWorkbenchSession)).toHaveBeenCalledWith(
      'sess-f',
      'flow-canvas',
      '画一个外呼流程',
      'D:/repo',
    )
    expect(getTabState('tab-flow')?.chatId).toBe('sess-f')
  })

  it('技能/工具面板开口不记侧栏会话', async () => {
    createTab('tab-mcp', { utilityKind: 'mcp', sessionId: 'sess-mcp' })
    await recordLiveSession('tab-mcp', 'hello')
    expect($chats.get()).toEqual([])
    expect(vi.mocked(touchWorkbenchSession)).not.toHaveBeenCalled()
  })

  it('工作台 Tab 不塞进编码列表', () => {
    createTab('tab-flow', {
      utilityKind: 'flow-canvas',
      sessionId: 'sess-flow',
      chatTitle: '画一个流程',
    })
    switchTab('tab-flow')
    $activeTabId.set('tab-flow')
    const listed = preserveActiveLiveChat([])
    expect(listed).toEqual([])
  })
})
