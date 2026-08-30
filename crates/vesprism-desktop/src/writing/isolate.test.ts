import { describe, expect, it } from 'vitest'
import { WRITING_SESSION_MODE, needsFreshSession, sessionReady, taskBelongsToBook } from './isolate'

describe('写台会话与数据隔离', () => {
  it('写台会话用只答模式，不给编程工具', () => {
    expect(WRITING_SESSION_MODE).toBe('ask')
  })

  it('写正文 / 检查 / 重写 / 补卡都要新开一轮会话，避免上一张卡漏进写手', () => {
    expect(needsFreshSession('write-chapter')).toBe(true)
    expect(needsFreshSession('fill-review')).toBe(true)
    expect(needsFreshSession('rewrite')).toBe(true)
    expect(needsFreshSession('fill-card')).toBe(true)
    expect(needsFreshSession('wash')).toBe(true)
    expect(needsFreshSession('ask')).toBe(false)
  })

  it('任务必须带本书 id，别的书的产出不能落进来', () => {
    expect(taskBelongsToBook({ bookId: 'book-a' }, 'book-a')).toBe(true)
    expect(taskBelongsToBook({ bookId: 'book-a' }, 'book-b')).toBe(false)
    expect(taskBelongsToBook({ bookId: '' }, 'book-a')).toBe(false)
    expect(taskBelongsToBook({}, 'book-a')).toBe(false)
  })

  it('会话要有 sessionId 且 phase=ready 才算就绪', () => {
    expect(sessionReady(null)).toBe(false)
    expect(sessionReady({ sessionId: '', phase: 'ready' })).toBe(false)
    expect(sessionReady({ sessionId: 's1', phase: 'booting' })).toBe(false)
    expect(sessionReady({ sessionId: 's1', phase: 'ready' })).toBe(true)
  })
})
