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
  /** 相关未收伏笔（3～5 条），给写手看着，不当到期。 */
  watch: ForeshadowRow[]
  beats: BeatCard[]
}

export function chapterNosIn(text: string): number[] {
  const nos: number[] = []
  for (const m of String(text || '').matchAll(/第(\d+)章/g)) {
    nos.push(Number(m[1]))
  }
  return nos
}

export function dueForeshadows(book: BookDemo, chapterNo: number): ForeshadowRow[] {
  return book.outline.foreshadows.filter((f) => {
    if (f.state === 'closed') return false
    const nos = chapterNosIn(f.thisVolume)
    if (!nos.includes(chapterNo)) return false
    if (f.state === 'due') return true
    return /到期|必须|兑现/.test(f.thisVolume)
  })
}

export function watchForeshadows(
  book: BookDemo,
  chapterNo: number,
  dueIds: Set<string>,
): ForeshadowRow[] {
  const scored = book.outline.foreshadows
    .filter((f) => f.state === 'open' && !dueIds.has(f.id))
    .map((f) => {
      let score = 0
      if (chapterNosIn(f.thisVolume).some((n) => Math.abs(n - chapterNo) <= 3)) score += 3
      if (chapterNosIn(f.plantVolume).some((n) => Math.abs(n - chapterNo) <= 3)) score += 2
      if (f.plantVolume.includes('卷') || f.thisVolume.includes('卷')) score += 1
      return { f, score }
    })
    .filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id))
  return scored.slice(0, 5).map((x) => x.f)
}

export function writeSlice(book: BookDemo, chapterId: string): WriteSlice | null {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return null
  const due = dueForeshadows(book, ch.no)
  const watch = watchForeshadows(book, ch.no, new Set(due.map((f) => f.id)))
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
      .filter((p) => ch.cast.includes(p.id) || (ch.where ?? []).includes(p.id))
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
    watch,
    beats: book.beatsByChapter[ch.id] || [],
  }
}

/** 切片禁止夹带的总纲字段（正文不得看见）。 */
export const SLICE_FORBIDDEN = ['causality', 'act1', 'act2', 'act3', 'volumeUpgrade'] as const
