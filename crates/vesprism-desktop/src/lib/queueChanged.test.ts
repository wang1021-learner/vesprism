import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types'
import {
  mergeQueueEntries,
  moveQueuedPrompt,
  paintRunningUserBubbles,
  runningUserTexts,
  type QueueRow,
} from './queueChanged'

const row = (id: string, text: string, position: number): QueueRow => ({
  id,
  version: 0,
  text,
  position,
})

describe('mergeQueueEntries', () => {
  it('服务器列表按 position 排序', () => {
    const merged = mergeQueueEntries(
      [row('b', 'B', 1), row('a', 'A', 0)],
      [],
    )
    expect(merged.map((q) => q.id)).toEqual(['a', 'b'])
  })

  it('本地乐观项尚未出现在 entries 时先留着', () => {
    const merged = mergeQueueEntries(
      [row('a', 'A', 0)],
      [row('a', 'A', 0), row('b', 'B', 1)],
    )
    expect(merged.map((q) => q.id)).toEqual(['a', 'b'])
    expect(merged[1].position).toBe(1)
  })

  it('正在跑的 id 不进排队条', () => {
    const merged = mergeQueueEntries(
      [row('b', 'B', 0)],
      [row('a', 'A', 0), row('b', 'B', 1)],
      'a',
    )
    expect(merged.map((q) => q.id)).toEqual(['b'])
  })
})

describe('moveQueuedPrompt', () => {
  it('上移一对相邻项并重写 position', () => {
    const next = moveQueuedPrompt(
      [row('a', 'A', 0), row('b', 'B', 1), row('c', 'C', 2)],
      'c',
      -1,
    )
    expect(next.map((q) => q.id)).toEqual(['a', 'c', 'b'])
    expect(next.map((q) => q.position)).toEqual([0, 1, 2])
  })

  it('已在队头上移 / 队尾下移是空操作', () => {
    const rows = [row('a', 'A', 0), row('b', 'B', 1)]
    expect(moveQueuedPrompt(rows, 'a', -1)).toEqual(rows)
    expect(moveQueuedPrompt(rows, 'b', 1)).toEqual(rows)
  })
})

describe('runningUserTexts', () => {
  it('combined 两条以上按原文拆开', () => {
    expect(runningUserTexts('a\n\nb', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('没有 combined 就用 running_text 一条', () => {
    expect(runningUserTexts('hello', undefined)).toEqual(['hello'])
  })
})

describe('paintRunningUserBubbles', () => {
  it('合并开跑后拆成多条用户气泡，共用 running promptId', () => {
    const next = paintRunningUserBubbles([], 'p-run', 'a\n\nb', ['a', 'b'])
    expect(next.map((m) => m.text)).toEqual(['a', 'b'])
    expect(next.every((m) => m.role === 'user' && m.promptId === 'p-run')).toBe(true)
  })

  it('已有同 promptId 且数量够了就不重复画', () => {
    const msgs: ChatMessage[] = [
      { id: '1', role: 'user', text: 'a', promptId: 'p-run' },
      { id: '2', role: 'user', text: 'b', promptId: 'p-run' },
    ]
    expect(paintRunningUserBubbles(msgs, 'p-run', 'a\n\nb', ['a', 'b'])).toBe(msgs)
  })

  it('一条合成气泡升级成拆开的多条，插在原位置、助手气泡之后不抢', () => {
    const msgs: ChatMessage[] = [
      { id: 'u0', role: 'user', text: 'old', promptId: 'p0' },
      { id: 'u1', role: 'user', text: 'a\n\nb', promptId: 'p-run' },
      { id: 'a1', role: 'assistant', text: '…', promptId: 'p-run' },
    ]
    const next = paintRunningUserBubbles(msgs, 'p-run', 'a\n\nb', ['a', 'b'])
    expect(next.map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:old',
      'user:a',
      'user:b',
      'assistant:…',
    ])
  })
})
