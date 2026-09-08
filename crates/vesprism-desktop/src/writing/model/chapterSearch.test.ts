import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { searchChapters } from './chapterSearch'

describe('长书检索', () => {
  it('按 job 过滤', () => {
    const hits = searchChapters(YANPIN_EYE, { job: '翻盘' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((c) => c.job === '翻盘')).toBe(true)
  })

  it('按章末钩类型过滤', () => {
    const hits = searchChapters(YANPIN_EYE, { hook: '危机' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((c) => c.endHookKind === '危机')).toBe(true)
  })

  it('按人物名检索（命中 cast）', () => {
    const hits = searchChapters(YANPIN_EYE, { query: '顾晚宁' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((c) => c.cast.includes('gu'))).toBe(true)
  })

  it('按地点名检索', () => {
    const hits = searchChapters(YANPIN_EYE, { query: '库房' })
    expect(hits.length).toBeGreaterThan(0)
  })
})
