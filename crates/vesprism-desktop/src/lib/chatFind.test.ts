import { describe, expect, it } from 'vitest'
import { findMessageHits, nextHit } from './chatFind'
import type { ChatMessage } from '../types'

const msgs = [
  { id: '1', role: 'user', text: '检查部署' },
  { id: '2', role: 'assistant', text: '正在看 CI' },
  { id: '3', role: 'user', text: '再查日志' },
] as ChatMessage[]

describe('findMessageHits', () => {
  it('大小写不敏感', () => {
    expect(findMessageHits(msgs, 'ci')).toEqual([1])
    expect(findMessageHits(msgs, '  ')).toEqual([])
  })
})

describe('nextHit', () => {
  it('循环前后跳', () => {
    expect(nextHit([0, 2], -1, 1)).toBe(0)
    expect(nextHit([0, 2], 0, 1)).toBe(2)
    expect(nextHit([0, 2], 2, 1)).toBe(0)
    expect(nextHit([0, 2], 2, -1)).toBe(0)
  })
})
