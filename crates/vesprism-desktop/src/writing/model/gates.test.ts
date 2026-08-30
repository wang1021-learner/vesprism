import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { emptyBook } from './empty-book'
import { actionForNode, chapterGate, gatesForBook, gatesForNode } from './gates'

describe('写台门槛', () => {
  it('演示书卡在第4章入卷未采纳', () => {
    const all = gatesForBook(YANPIN_EYE)
    expect(all.find((g) => g.id === 'pitch-canon')?.ok).toBe(true)
    expect(all.find((g) => g.id === 'chapter-beats')?.ok).toBe(true)
    expect(all.find((g) => g.id === 'review-next')?.ok).toBe(false)
  })

  it('第5章因入卷未采纳上锁；第4章可写本章', () => {
    const ch4 = YANPIN_EYE.chapters.find((c) => c.id === 'ch-4')
    const ch5 = YANPIN_EYE.chapters.find((c) => c.id === 'ch-5')
    expect(chapterGate(ch4).canWrite).toBe(true)
    expect(chapterGate(ch5).canWrite).toBe(false)
    expect(chapterGate(ch5).reason).toMatch(/入卷/)
  })

  it('第1章入卷已采纳可拆下一章；第4章默认入卷；第5章写本章锁', () => {
    expect(actionForNode(YANPIN_EYE, 'ch-1:review')).toMatchObject({
      label: '开下一章',
      ok: true,
    })
    expect(actionForNode(YANPIN_EYE, 'ch-4:review')).toMatchObject({
      label: '入卷',
      ok: false,
    })
    expect(actionForNode(YANPIN_EYE, 'ch-5').ok).toBe(false)
    expect(actionForNode(YANPIN_EYE, 'ch-4').ok).toBe(true)
  })

  it('当前节点只展示相关门，不把第4章的锁套到第1章', () => {
    const ch1 = gatesForNode(YANPIN_EYE, 'ch-1')
    expect(ch1.some((g) => g.id === 'review-next')).toBe(false)
    expect(ch1.every((g) => g.ok)).toBe(true)
    const ch5 = gatesForNode(YANPIN_EYE, 'ch-5')
    expect(ch5).toHaveLength(1)
    expect(ch5[0]?.id).toBe('review-next')
    expect(ch5[0]?.ok).toBe(false)
  })

  it('空书门槛不拿演示书的 unit-b / ch-4 去套', () => {
    const all = gatesForBook(emptyBook({ title: '试', platform: '番茄', logline: '一句' }))
    expect(all.find((g) => g.id === 'volume-unit')?.ok).toBe(false)
    expect(all.find((g) => g.id === 'unit-chapter')?.ok).toBe(false)
    expect(all.find((g) => g.id === 'chapter-beats')?.ok).toBe(false)
  })
})
