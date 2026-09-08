/**
 * 长书导航检索：按关键词 / job / 章末钩类型过滤章节。
 * 同时是作者导航和（未来）AI 长程召回共用的数据入口。
 */
import type { BookDemo, ChapterCard } from './types'

export type ChapterFilter = {
  query?: string
  job?: string
  hook?: string
}

export function searchChapters(book: BookDemo, filter: ChapterFilter = {}): ChapterCard[] {
  const q = (filter.query || '').trim().toLowerCase()
  const job = (filter.job || '').trim()
  const hook = (filter.hook || '').trim()
  const people = new Map(book.people.map((p) => [p.id, p.name]))
  const places = new Map(book.places.map((p) => [p.id, p.name]))

  return [...book.chapters]
    .sort((a, b) => a.no - b.no)
    .filter((ch) => {
      if (job && ch.job !== job) return false
      if (hook && ch.endHookKind !== hook) return false
      if (!q) return true
      const castNames = ch.cast.map((id) => people.get(id) ?? places.get(id) ?? id).join(' ')
      const whereNames = (ch.where ?? []).map((id) => places.get(id) ?? id).join(' ')
      const hay =
        `第${ch.no}章 ${ch.title} ${ch.job} ${ch.endHookKind} ${castNames} ${whereNames}`.toLowerCase()
      return hay.includes(q)
    })
}
