/** 写本章切片：正文只吃这些，不吃总纲全文。 */

import type { BeatCard, BookDemo, CanonCard, ForeshadowRow, PersonCard, PlaceCard, RuleCard } from './types'

export type WriteSlice = {
  chapterId: string
  no: number
  title: string
  locked: boolean
  lockReason: string
  canon: Pick<
    CanonCard,
    'pov' | 'powerCap' | 'narrativeBan' | 'sentenceBan' | 'chapterWords' | 'doneWhen' | 'samples'
  >
  people: Pick<PersonCard, 'id' | 'name' | 'state' | 'mustNotKnow' | 'voiceSample'>[]
  places: Pick<PlaceCard, 'id' | 'name' | 'job'>[]
  rules: Pick<RuleCard, 'id' | 'name' | 'quota' | 'cannot' | 'quotaLeft'>[]
  due: ForeshadowRow[]
  beats: BeatCard[]
}

export function writeSlice(book: BookDemo, chapterId: string): WriteSlice | null {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return null
  const blob = `${ch.plant} ${ch.press} ${ch.close} 第${ch.no}章`
  const chapterMark = `第${ch.no}章`
  const due = book.outline.foreshadows.filter((f) => {
    if (f.state === 'closed') return false
    const scheduled =
      blob.includes(f.id) ||
      f.thisVolume.includes(chapterMark) ||
      (f.state === 'due' && f.thisVolume.includes(chapterMark))
    if (f.state === 'due') return blob.includes(f.id) || f.thisVolume.includes(chapterMark)
    // open 但本卷写明本章到期 → 当到期伏笔给写手
    return scheduled && /到期|必须|兑现/.test(f.thisVolume)
  })
  return {
    chapterId: ch.id,
    no: ch.no,
    title: ch.title,
    locked: Boolean(ch.locked),
    lockReason: ch.lockReason || '',
    canon: {
      pov: book.canon.pov,
      powerCap: book.canon.powerCap,
      narrativeBan: book.canon.narrativeBan,
      sentenceBan: book.canon.sentenceBan,
      chapterWords: book.canon.chapterWords,
      doneWhen: book.canon.doneWhen,
      samples: book.canon.samples,
    },
    people: book.people
      .filter((p) => ch.cast.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        state: p.state,
        mustNotKnow: p.mustNotKnow,
        voiceSample: p.voiceSample,
      })),
    places: book.places
      .filter((p) => ch.cast.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, job: p.job })),
    rules: book.rules
      .filter((r) => ch.cast.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        quota: (r.quotaLeft || '').trim() ? r.quotaLeft : r.quota,
        quotaLeft: r.quotaLeft || '',
        cannot: r.cannot,
      })),
    due,
    beats: book.beatsByChapter[ch.id] || [],
  }
}

/** 切片禁止夹带的总纲字段（正文不得看见）。 */
export const SLICE_FORBIDDEN = ['causality', 'act1', 'act2', 'act3', 'volumeUpgrade'] as const
