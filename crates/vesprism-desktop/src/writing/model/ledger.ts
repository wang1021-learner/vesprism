/** 账本：伏笔票、人物当前态、规则配额。回写未采纳前只展示，不改。 */

import type { BookDemo, DeskNodeId, ForeshadowRow, ForeshadowState } from './types'

export function foreshadowLabel(state: ForeshadowState): string {
  if (state === 'due') return '到期'
  if (state === 'closed') return '已收'
  return '未收'
}

export function foreshadowJump(row: ForeshadowRow): DeskNodeId {
  const m = /第(\d+)章/.exec(row.thisVolume)
  if (m) return `ch-${m[1]}`
  return 'outline'
}

export type LedgerPerson = {
  id: string
  name: string
  role: string
  state: string
  asOf: number
}

export type LedgerRule = {
  id: string
  name: string
  quota: string
  boundTo: string
}

export type LedgerPlace = {
  id: string
  name: string
  job: string
}

export type BookLedger = {
  foreshadows: ForeshadowRow[]
  people: LedgerPerson[]
  rules: LedgerRule[]
  places: LedgerPlace[]
}

export function bookLedger(book: BookDemo): BookLedger {
  return {
    foreshadows: [...book.outline.foreshadows].sort((a, b) => {
      const rank = { due: 0, open: 1, closed: 2 }
      return rank[a.state] - rank[b.state]
    }),
    people: book.people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      state: p.state,
      asOf: p.stateAsOfChapter,
    })),
    rules: book.rules.map((r) => ({
      id: r.id,
      name: r.name,
      quota: r.quota,
      boundTo: r.boundTo,
    })),
    places: book.places.map((p) => ({ id: p.id, name: p.name, job: p.job })),
  }
}
