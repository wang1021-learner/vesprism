/** 案卷：伏线、人物当前态、规则配额。入卷未采纳前只展示，不改。 */

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

export type DossierPerson = {
  id: string
  name: string
  role: string
  state: string
  asOf: number
}

export type DossierRule = {
  id: string
  name: string
  quota: string
  boundTo: string
}

export type DossierPlace = {
  id: string
  name: string
  job: string
}

export type BookDossier = {
  foreshadows: ForeshadowRow[]
  people: DossierPerson[]
  rules: DossierRule[]
  places: DossierPlace[]
}

export function bookDossier(book: BookDemo): BookDossier {
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
