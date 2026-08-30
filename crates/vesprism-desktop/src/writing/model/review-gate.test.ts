import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { applyReviewFromJson, registerForeshadowsFromReview } from './apply'
import { reviewBlocksAdopt, styleHits } from './review-gate'
import { verbsForStation } from '../framework/station'

function acceptedWithReview(json: Record<string, unknown>) {
  const withReview = applyReviewFromJson(YANPIN_EYE, 'ch-4', json)
  return {
    ...withReview,
    drafts: withReview.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
  }
}

describe('入卷硬门', () => {
  it('未编号有内容且未进表则挡；编号后不挡', () => {
    const book = acceptedWithReview({ unnumbered: '旧门后还有第二把钥匙' })
    const blocked = reviewBlocksAdopt(book, 'ch-4')
    expect(blocked.ok).toBe(false)
    expect(blocked.hints.join('')).toMatch(/未编号/)
    const numbered = registerForeshadowsFromReview(book, 'ch-4')
    expect(reviewBlocksAdopt(numbered, 'ch-4').ok).toBe(true)
  })

  it('正文命中不能知道的则挡', () => {
    const base = acceptedWithReview({ unnumbered: '无' })
    const book = {
      ...base,
      drafts: base.drafts.map((d) =>
        d.chapterId === 'ch-4'
          ? {
              ...d,
              accepted: true,
              beats: d.beats.map((b, i) => (i === 0 ? { ...b, body: '他知道旧门后那人的名字' } : b)),
            }
          : d,
      ),
    }
    expect(reviewBlocksAdopt(book, 'ch-4').ok).toBe(false)
    expect(reviewBlocksAdopt(book, 'ch-4').hints.join('')).toMatch(/不能知道|不该/)
  })

  it('句式套话不挡入卷', () => {
    const base = acceptedWithReview({ unnumbered: '无' })
    const book = {
      ...base,
      drafts: base.drafts.map((d) =>
        d.chapterId === 'ch-4'
          ? {
              ...d,
              accepted: true,
              beats: d.beats.map((b, i) =>
                i === 0 ? { ...b, body: '他深吸一口气。真正的考验才刚刚开始。' } : b,
              ),
            }
          : d,
      ),
    }
    expect(reviewBlocksAdopt(book, 'ch-4').ok).toBe(true)
    expect(styleHits(book, 'ch-4').length).toBeGreaterThan(0)
  })

  it('入卷芯片在红项时 ok=false，文案不是建议采纳', () => {
    const book = acceptedWithReview({ unnumbered: '还没编号的秘密' })
    const v = verbsForStation(book, 'ch-4:review')
    expect(v.find((x) => x.id === 'adopt-ledger')?.ok).toBe(false)
    expect(v.find((x) => x.id === 'adopt-ledger')?.hint).not.toMatch(/建议采纳/)
  })
})
