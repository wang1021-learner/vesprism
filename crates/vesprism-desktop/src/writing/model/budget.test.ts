import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { budgetLeft, canSpendTask, chapterSpend, recordSpend, WRITE_BUDGET } from './budget'

describe('每章调用预算', () => {
  it('写章按章计数；补卡不计', () => {
    expect(canSpendTask(YANPIN_EYE, 'ch-4', 'write-chapter')).toBe(true)
    expect(canSpendTask(YANPIN_EYE, undefined, 'fill-card')).toBe(true)
    expect(canSpendTask(YANPIN_EYE, 'ch-4', 'fill-card')).toBe(true)
  })

  it('累计到上限就停', () => {
    let book = YANPIN_EYE
    for (let i = 0; i < WRITE_BUDGET.perChapterCalls; i++) book = recordSpend(book, 'ch-4')
    expect(chapterSpend(book, 'ch-4')).toBe(WRITE_BUDGET.perChapterCalls)
    expect(budgetLeft(book, 'ch-4')).toBe(0)
    expect(canSpendTask(book, 'ch-4', 'rewrite')).toBe(false)
  })

  it('不同章各自计数', () => {
    const book = recordSpend(YANPIN_EYE, 'ch-1')
    expect(chapterSpend(book, 'ch-4')).toBe(0)
    expect(canSpendTask(book, 'ch-4', 'write-chapter')).toBe(true)
  })
})
