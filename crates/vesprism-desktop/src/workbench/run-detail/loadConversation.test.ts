import { describe, expect, it, vi } from 'vitest'
import {
  conversationSessionIds,
  loadRunConversation,
  withOutputFallback,
} from './loadConversation'

describe('conversationSessionIds', () => {
  it('child 优先，和 agentId 去重', () => {
    expect(conversationSessionIds({ childSessionId: 'sess-a', agentId: 'sess-a' })).toEqual(['sess-a'])
    expect(conversationSessionIds({ childSessionId: 'sess-a', agentId: 'agent-1' })).toEqual(['sess-a'])
    expect(conversationSessionIds({ agentId: 'agent-1' })).toEqual(['agent-1'])
  })
})

describe('withOutputFallback', () => {
  it('没有助手气泡时用产出摘要垫一条', () => {
    const msgs = withOutputFallback([], '完成了摘要')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].text).toBe('完成了摘要')
  })

  it('已有助手正文则不垫', () => {
    const msgs = withOutputFallback(
      [{ id: 'a', role: 'assistant', text: '已写好' }],
      '完成了摘要',
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('已写好')
  })
})

describe('loadRunConversation', () => {
  it('第一个 id 能拉到消息就用它', async () => {
    const get = vi.fn(async (id: string) =>
      id === 'sess-a' ? [{ id: '1', role: 'user', text: 'hello' }] : [],
    )
    const r = await loadRunConversation(['sess-a', 'agent-1'], undefined, get)
    expect(r.sessionId).toBe('sess-a')
    expect(r.messages.map((m) => m.text)).toEqual(['hello'])
    expect(r.error).toBe('')
  })

  it('找不到会话目录时试下一个 id，再用产出兜底', async () => {
    const get = vi.fn(async (id: string) => {
      if (id === 'agent-1') throw new Error('找不到会话目录: agent-1')
      return [{ id: '1', role: 'assistant', text: '从磁盘来' }]
    })
    const r = await loadRunConversation(['agent-1', 'sess-real'], '摘要', get)
    expect(r.sessionId).toBe('sess-real')
    expect(r.messages.some((m) => m.text === '从磁盘来')).toBe(true)
  })

  it('全都找不到目录且有产出：展示摘要，不把错误甩到空页', async () => {
    const get = vi.fn(async () => {
      throw new Error('找不到会话目录: x')
    })
    const r = await loadRunConversation(['x'], '只有摘要', get)
    expect(r.messages.some((m) => m.text === '只有摘要')).toBe(true)
    expect(r.error).toBe('')
  })

  it('没有 id 也没有产出', async () => {
    const r = await loadRunConversation([], undefined, async () => [])
    expect(r.messages).toEqual([])
    expect(r.error).toBe('没有可查看的对话')
  })
})
