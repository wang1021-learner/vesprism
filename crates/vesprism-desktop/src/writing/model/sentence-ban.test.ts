import { describe, expect, it } from 'vitest'
import { emptyBook } from './empty-book'
import { DEFAULT_SENTENCE_BAN, DEFAULT_SENTENCE_BAN_LINES, effectiveSentenceBan } from './sentence-ban'
import { writeSlice } from './slice'
import { rewriteUser, writerUser } from '../framework/prompt'
import { YANPIN_EYE } from './demo-yanpin'

describe('默认句式禁', () => {
  it('正好八条，且是网文句式不是公众号腔', () => {
    expect(DEFAULT_SENTENCE_BAN_LINES).toHaveLength(8)
    expect(DEFAULT_SENTENCE_BAN).toContain('不是 A，而是 B')
    expect(DEFAULT_SENTENCE_BAN).toContain('深吸一口气')
    expect(DEFAULT_SENTENCE_BAN).toContain('真正的考验才刚刚开始')
  })

  it('空书预填句式禁；人清空后提示词仍回填，卡面保持空', () => {
    const book = emptyBook({ title: '试', platform: '番茄', logline: '一句' })
    expect(book.canon.sentenceBan.trim().length).toBeGreaterThan(0)
    expect(book.canon.sentenceBan).toContain('深吸一口气')
    const cleared = { ...book, canon: { ...book.canon, sentenceBan: '' } }
    expect(cleared.canon.sentenceBan).toBe('')
    expect(effectiveSentenceBan(cleared.canon.sentenceBan)).toContain('不是 A，而是 B')
  })

  it('切片带文风样本；写手词含样本和句式禁，不含总纲', () => {
    const s = writeSlice(YANPIN_EYE, 'ch-4')
    expect(s?.canon.samples[0]).toContain('喷枪走得太匀')
    const user = writerUser(YANPIN_EYE, 'ch-4')
    expect(user).toContain('喷枪走得太匀')
    expect(user).toMatch(/只模仿写法|不当故事材料/)
    expect(user).toContain(YANPIN_EYE.canon.sentenceBan)
    expect(user).not.toContain(YANPIN_EYE.outline.causality)
  })

  it('清空句式禁后 writerUser 仍含硬名单，且不把硬名单写回卡', () => {
    const book = {
      ...YANPIN_EYE,
      canon: { ...YANPIN_EYE.canon, sentenceBan: '' },
    }
    const user = writerUser(book, 'ch-4')
    expect(user).toContain('不是 A，而是 B')
    expect(book.canon.sentenceBan).toBe('')
  })

  it('rewriteUser 带句式禁和出场声口样本', () => {
    const beat = YANPIN_EYE.beatsByChapter['ch-4'][0]
    expect(beat).toBeTruthy()
    if (!beat) return
    const u = rewriteUser(YANPIN_EYE, 'ch-4', beat)
    expect(u).toContain('句式禁')
    expect(u).toContain('那你让他们看货')
    expect(u).not.toContain(YANPIN_EYE.outline.act1)
  })
})
