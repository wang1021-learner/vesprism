/**
 * 溯源引用搜索：改了一个人名/地名/关键设定后，找出全书还有哪里提到它。
 * 章用 id 引用人物/地点（改名自动跟随），伏笔/检查单是自由文本（会变孤儿）。
 */
import type { BookDemo, ChapterCard, ForeshadowRow, PersonCard, PlaceCard, ReviewCard } from './types'

export type References = {
  chapters: ChapterCard[]
  foreshadows: ForeshadowRow[]
  reviews: ReviewCard[]
  people: PersonCard[]
  places: PlaceCard[]
}

export function findReferences(book: BookDemo, token: string): References {
  const t = (token || '').trim()
  const empty: References = { chapters: [], foreshadows: [], reviews: [], people: [], places: [] }
  if (!t) return empty
  const lower = t.toLowerCase()
  const hit = (s: string | undefined) => (s || '').toLowerCase().includes(lower)

  const people = book.people.filter(
    (p) => hit(p.name) || hit(p.id) || hit(p.state) || hit(p.relationToLead) || hit(p.voiceSample),
  )
  const places = book.places.filter((p) => hit(p.name) || hit(p.id) || hit(p.job))
  const ids = new Set([...people.map((p) => p.id), ...places.map((p) => p.id)])

  const chapters = book.chapters.filter(
    (c) =>
      hit(c.title) ||
      hit(c.goal) ||
      hit(c.openHook) ||
      hit(c.endHook) ||
      c.cast.some((id) => ids.has(id)) ||
      (c.where ?? []).some((id) => ids.has(id)),
  )
  const foreshadows = book.outline.foreshadows.filter((f) => hit(f.line) || hit(f.id))
  const reviews = book.reviews.filter(
    (r) =>
      hit(r.summary80) ||
      hit(r.openHookOk) ||
      hit(r.endHookOk) ||
      hit(r.powerNow) ||
      r.states.some((s) => hit(s)) ||
      r.foreshadow.some((s) => hit(s)),
  )
  return { chapters, foreshadows, reviews, people, places }
}
