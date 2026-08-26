import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTab,
  getTabState,
  resetTabsForTests,
  switchTab,
} from '../store'

const sendPrompt = vi.fn()
const interjectPrompt = vi.fn()

vi.mock('../bridge', () => ({
  sendPrompt: (...a: unknown[]) => sendPrompt(...a),
  interjectPrompt: (...a: unknown[]) => interjectPrompt(...a),
}))

const { sendSessionPrompt } = await import('./sendSessionPrompt')

describe('sendSessionPrompt', () => {
  beforeEach(() => {
    resetTabsForTests()
    sendPrompt.mockReset().mockResolvedValue(undefined)
    interjectPrompt.mockReset()
  })

  it('历史画出了但没接上引擎：不发，提示点重试', async () => {
    createTab('tab-1', {
      chatId: 'sid-1',
      sessionId: '',
      messages: [{ id: 'm1', role: 'user', text: 'hi' } as never],
      phase: 'ready',
    })
    switchTab('tab-1')
    const id = await sendSessionPrompt({ text: '继续' })
    expect(id).toBeNull()
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(getTabState('tab-1')?.error).toContain('重试')
  })

  it('已接上则照常发送', async () => {
    createTab('tab-1', {
      chatId: 'sid-1',
      sessionId: 'sid-1',
      messages: [],
      phase: 'ready',
    })
    switchTab('tab-1')
    const id = await sendSessionPrompt({ text: '你好' })
    expect(id).toBeTruthy()
    expect(sendPrompt).toHaveBeenCalled()
  })

  it('图片附件进气泡字段，正文不写 [附件] 文件名', async () => {
    createTab('tab-1', {
      chatId: 'sid-1',
      sessionId: 'sid-1',
      messages: [],
      phase: 'ready',
    })
    switchTab('tab-1')
    await sendSessionPrompt({
      text: '这是什么',
      attachments: [
        {
          kind: 'image',
          path: 'C:\\\\Temp\\\\vesprism-paste\\\\paste-1.png',
          previewUrl: 'blob:preview',
        },
      ],
    })
    const msg = getTabState('tab-1')?.messages.find((m) => m.role === 'user')
    expect(msg?.text).toBe('这是什么')
    expect(msg?.text).not.toContain('[附件]')
    expect(msg?.attachments).toEqual([
      {
        kind: 'image',
        path: 'C:\\\\Temp\\\\vesprism-paste\\\\paste-1.png',
        previewUrl: 'blob:preview',
      },
    ])
  })
})
