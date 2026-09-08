import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { applyReviewFromJson, registerForeshadowsFromReview } from './apply'
import {
  chapterDriftNotes,
  chapterNumberNotes,
  endingNotes,
  exportBookPlain,
  exportChapterPlain,
  exportVolumePlain,
  foreshadowOrphans,
  goldenThreeNotes,
  reviewBlocksAdopt,
  styleHits,
  wordCountNotes,
} from './review-gate'
import { verbsForStation } from '../framework/station'

function acceptedWithReview(json: Record<string, unknown>) {
  const withReview = applyReviewFromJson(YANPIN_EYE, 'ch-4', {
    summary80: '库房旧门有人逼开第三眼。',
    ...json,
  })
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

  it('摘要空则挡入卷', () => {
    const book = acceptedWithReview({ unnumbered: '无', summary80: '   ' })
    const blocked = reviewBlocksAdopt(book, 'ch-4')
    expect(blocked.ok).toBe(false)
    expect(blocked.hints.join('')).toMatch(/摘要/)
  })

  it('导出只出正史，试笔不进 txt', () => {
    expect(exportChapterPlain(YANPIN_EYE, 'ch-4')).toBe('')
    expect(exportChapterPlain(YANPIN_EYE, 'ch-1')).toContain('夜场灯把他按在拍品前')
    const all = exportBookPlain(YANPIN_EYE)
    expect(all).toContain('赝品眼')
    expect(all).toContain('第1章')
    expect(all).not.toContain('铁架上的编号贴纸')
    const vol = exportVolumePlain(YANPIN_EYE, 'vol-1')
    expect(vol).toContain('第1章')
    expect(vol).not.toContain('铁架上的编号贴纸')
  })

  it('字数不够或超了只警告，不挡入卷', () => {
    const short = acceptedWithReview({ unnumbered: '无' })
    const notes = wordCountNotes(short, 'ch-4')
    expect(notes.join('')).toMatch(/字/)
    expect(reviewBlocksAdopt(short, 'ch-4').ok).toBe(true)
  })

  it('黄金三章：1～3 章爽点/章末钩为空则挡，中段不管', () => {
    expect(goldenThreeNotes(YANPIN_EYE, 'ch-1')).toEqual([])
    expect(goldenThreeNotes(YANPIN_EYE, 'ch-4')).toEqual([])
    const empty = {
      ...YANPIN_EYE,
      chapters: YANPIN_EYE.chapters.map((c) =>
        c.id === 'ch-1' ? { ...c, pleasure: '', endHookKind: '' as const } : c,
      ),
    }
    expect(goldenThreeNotes(empty, 'ch-1').join('')).toMatch(/爽点/)
    expect(goldenThreeNotes(empty, 'ch-1').join('')).toMatch(/章末钩/)
  })

  it('收尾段缺完本计划只提示，补了就不提示', () => {
    expect(endingNotes(YANPIN_EYE, 'ch-4').length).toBeGreaterThan(0)
    const done = {
      ...YANPIN_EYE,
      outline: { ...YANPIN_EYE.outline, endingPlan: '大结局：三次配额用完，主角看懂旧门。' },
    }
    expect(endingNotes(done, 'ch-4')).toEqual([])
  })

  it('正文命中平台红线则挡入卷', () => {
    const base = acceptedWithReview({ unnumbered: '无' })
    const book = {
      ...base,
      canon: { ...base.canon, complianceBan: '违禁词A；违禁词B' },
      drafts: base.drafts.map((d) =>
        d.chapterId === 'ch-4'
          ? { ...d, accepted: true, beats: d.beats.map((b, i) => (i === 0 ? { ...b, body: '这一段出现了违禁词A。' } : b)) }
          : d,
      ),
    }
    const blocked = reviewBlocksAdopt(book, 'ch-4')
    expect(blocked.ok).toBe(false)
    expect(blocked.hints.join('')).toMatch(/红线/)
  })

  it('章纲偏差：章末钩没落到文末才提示', () => {
    const base = {
      ...YANPIN_EYE,
      chapters: YANPIN_EYE.chapters.map((c) => (c.id === 'ch-4' ? { ...c, endHook: '「别回头」' } : c)),
    }
    const missing = {
      ...base,
      drafts: base.drafts.map((d) =>
        d.chapterId === 'ch-4'
          ? { ...d, beats: d.beats.map((b, i) => (i === d.beats.length - 1 ? { ...b, body: '他转身走了。' } : b)) }
          : d,
      ),
    }
    expect(chapterDriftNotes(missing, 'ch-4').join('')).toMatch(/偏差/)
    const landed = {
      ...base,
      drafts: base.drafts.map((d) =>
        d.chapterId === 'ch-4'
          ? { ...d, beats: d.beats.map((b, i) => (i === d.beats.length - 1 ? { ...b, body: '「别回头」。' } : b)) }
          : d,
      ),
    }
    expect(chapterDriftNotes(landed, 'ch-4')).toEqual([])
  })

  it('伏笔孤儿：line 提到不在设定集的名字才提示', () => {
    const book = {
      ...YANPIN_EYE,
      outline: {
        ...YANPIN_EYE.outline,
        foreshadows: [
          ...YANPIN_EYE.outline.foreshadows,
          { id: 'F099', line: '旧友林远山藏着一把钥匙', plantVolume: '', thisVolume: '', closeWhen: '', state: 'open' as const },
        ],
      },
    }
    expect(foreshadowOrphans(book).join('')).toMatch(/林远山/)
  })

  it('章号连续性：重号/缺号才提示', () => {
    expect(chapterNumberNotes(YANPIN_EYE)).toEqual([])
    const dup = {
      ...YANPIN_EYE,
      chapters: YANPIN_EYE.chapters.map((c) => (c.id === 'ch-2' ? { ...c, no: 1 } : c)),
    }
    expect(chapterNumberNotes(dup).join('')).toMatch(/重复/)
    const gap = {
      ...YANPIN_EYE,
      chapters: YANPIN_EYE.chapters.filter((c) => c.id !== 'ch-3'),
    }
    expect(chapterNumberNotes(gap).join('')).toMatch(/缺失/)
  })
})
