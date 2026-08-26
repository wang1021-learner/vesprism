import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  $scratchCwd,
  createTab,
  getTabState,
  resetTabsForTests,
} from '../store'

const loadSession = vi.fn()
const restartTab = vi.fn()

vi.mock('../bridge', () => ({
  loadSession: (...a: unknown[]) => loadSession(...a),
  restartTab: (...a: unknown[]) => restartTab(...a),
}))

const { retryTabSession } = await import('./retryTab')
const { isAttachingRuntime } = await import('./sessionOpen')

describe('retryTabSession', () => {
  beforeEach(() => {
    resetTabsForTests()
    $scratchCwd.set('C:\\Users\\me\\.vesprism\\scratch')
    loadSession.mockReset().mockResolvedValue('C:\\Users\\me\\.vesprism\\scratch')
    restartTab.mockReset().mockResolvedValue(undefined)
    createTab('tab-1', {
      chatId: 'sid-1',
      sessionId: '',
      cwd: 'C:/Users/me/.vesprism/scratch',
      phase: 'ready',
      error: '没能接上这条对话。聊天记录还在，请点「重试」。',
      messages: [{ id: 'm1', role: 'user', text: 'hi' } as never],
    })
  })

  it('有历史 id：loadSession，并用回执 cwd；期间会挂 attach 闸门', async () => {
    const pending = new Promise<string>((resolve) => {
      queueMicrotask(() => {
        expect(isAttachingRuntime('tab-1')).toBe(true)
        resolve('D:\\actual')
      })
    })
    loadSession.mockReturnValue(pending)
    await retryTabSession('tab-1')
    expect(loadSession).toHaveBeenCalledWith(
      'tab-1',
      'sid-1',
      'C:\\Users\\me\\.vesprism\\scratch',
    )
    expect(restartTab).not.toHaveBeenCalled()
    const st = getTabState('tab-1')
    expect(st?.sessionId).toBe('sid-1')
    expect(st?.cwd).toBe('D:\\actual')
    expect(st?.error).toBe('')
    expect(st?.phase).toBe('ready')
    expect(isAttachingRuntime('tab-1')).toBe(false)
  })

  it('load 失败：留下记录，不拆 Tab 去 restart', async () => {
    loadSession.mockRejectedValueOnce(
      'Path not found.: { "code": "FS_NOT_FOUND" }',
    )
    await retryTabSession('tab-1')
    expect(restartTab).not.toHaveBeenCalled()
    const st = getTabState('tab-1')
    expect(st?.error).toContain('聊天记录还在')
    expect(st?.messages).toHaveLength(1)
    expect(st?.phase).toBe('ready')
    expect(isAttachingRuntime('tab-1')).toBe(false)
  })

  it('没有会话 id 才 restartTab', async () => {
    resetTabsForTests()
    createTab('tab-2', { chatId: '', sessionId: '', cwd: 'D:\\repo' })
    await retryTabSession('tab-2')
    expect(loadSession).not.toHaveBeenCalled()
    expect(restartTab).toHaveBeenCalledWith('tab-2')
  })
})
