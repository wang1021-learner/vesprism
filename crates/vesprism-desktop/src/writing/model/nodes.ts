/** 写台树节点：层、实体、章内子页。只做路由，不写盘。 */

import type { BookDemo, DeskNodeId } from './types'

export type LayerId =
  | 'pitch'
  | 'canon'
  | 'bible'
  | 'outline'
  | 'volume'
  | 'unit'
  | 'chapter'
  | 'beats'
  | 'draft'
  | 'review'

export type ParsedNode =
  | { kind: 'engine' }
  | { kind: 'pitch' }
  | { kind: 'canon' }
  | { kind: 'bible' }
  | { kind: 'person'; id: string }
  | { kind: 'rule'; id: string }
  | { kind: 'place'; id: string }
  | { kind: 'outline' }
  | { kind: 'volume'; id: string }
  | { kind: 'unit'; id: string }
  | { kind: 'chapter'; id: string }
  | { kind: 'beats'; chapterId: string }
  | { kind: 'draft'; chapterId: string }
  | { kind: 'review'; chapterId: string }

export type WorkMode = 'set' | 'plan' | 'draft' | 'check'

export const LAYER_STEPS: readonly {
  layer: LayerId
  lot: string
  label: string
  mode: WorkMode
}[] = [
  { layer: 'pitch', lot: '1', label: '卖点', mode: 'set' },
  { layer: 'canon', lot: '2', label: '规矩', mode: 'set' },
  { layer: 'bible', lot: '3', label: '设定集', mode: 'set' },
  { layer: 'outline', lot: '1', label: '长线', mode: 'plan' },
  { layer: 'volume', lot: '2', label: '这一卷', mode: 'plan' },
  { layer: 'unit', lot: '3', label: '这几章', mode: 'plan' },
  { layer: 'chapter', lot: '4', label: '这一章', mode: 'plan' },
  { layer: 'beats', lot: '5', label: '切块', mode: 'plan' },
  { layer: 'draft', lot: '1', label: '稿纸', mode: 'draft' },
  { layer: 'review', lot: '1', label: '对照', mode: 'check' },
]

export function personNode(id: string): DeskNodeId {
  return `person-${id}`
}
export function ruleNode(id: string): DeskNodeId {
  return `rule-${id}`
}
export function placeNode(id: string): DeskNodeId {
  return `place-${id}`
}
export function beatsNode(chapterId: string): DeskNodeId {
  return `${chapterId}:beats`
}
export function draftNode(chapterId: string): DeskNodeId {
  return `${chapterId}:draft`
}
export function reviewNode(chapterId: string): DeskNodeId {
  return `${chapterId}:review`
}

export function parseNode(id: DeskNodeId): ParsedNode {
  if (id === 'engine') return { kind: 'engine' }
  if (id === 'pitch') return { kind: 'pitch' }
  if (id === 'canon') return { kind: 'canon' }
  if (id === 'bible') return { kind: 'bible' }
  if (id === 'outline') return { kind: 'outline' }
  if (id.startsWith('person-')) return { kind: 'person', id: id.slice('person-'.length) }
  if (id.startsWith('rule-')) return { kind: 'rule', id: id.slice('rule-'.length) }
  if (id.startsWith('place-')) return { kind: 'place', id: id.slice('place-'.length) }
  if (id.startsWith('vol-')) return { kind: 'volume', id }
  if (id.startsWith('unit-')) return { kind: 'unit', id }
  const child = /^(ch-\d+):(beats|draft|review)$/.exec(id)
  if (child) {
    const chapterId = child[1]
    const kind = child[2]
    if (kind === 'beats') return { kind: 'beats', chapterId }
    if (kind === 'draft') return { kind: 'draft', chapterId }
    return { kind: 'review', chapterId }
  }
  if (id.startsWith('ch-')) return { kind: 'chapter', id }
  return { kind: 'pitch' }
}

export function layerOf(node: ParsedNode): LayerId | null {
  if (node.kind === 'engine') return null
  if (node.kind === 'person' || node.kind === 'rule' || node.kind === 'place') return 'bible'
  return node.kind
}

export function modeOf(node: ParsedNode): WorkMode {
  if (node.kind === 'engine' || node.kind === 'pitch' || node.kind === 'canon') return 'set'
  if (node.kind === 'bible' || node.kind === 'person' || node.kind === 'rule' || node.kind === 'place') {
    return 'set'
  }
  if (node.kind === 'draft') return 'draft'
  if (node.kind === 'review') return 'check'
  return 'plan'
}

export function stepsInMode(mode: WorkMode) {
  return LAYER_STEPS.filter((s) => s.mode === mode)
}

export function jumpMode(mode: WorkMode, book: BookDemo, chapterId: string): DeskNodeId {
  if (mode === 'set') return 'pitch'
  if (mode === 'plan') return book.volumes[0]?.id ?? 'outline'
  if (mode === 'draft') {
    const pending = book.drafts.find((d) => !d.accepted)
    if (pending) return draftNode(pending.chapterId)
    const last = book.drafts.at(-1)
    if (last) return draftNode(last.chapterId)
    const ch = book.chapters.find((c) => c.id === chapterId) ?? book.chapters.filter((c) => !c.locked).at(-1)
    return ch ? draftNode(ch.id) : 'outline'
  }
  const pendingReview = book.reviews.find((r) => !r.adopted)
  if (pendingReview) return reviewNode(pendingReview.chapterId)
  const lastReview = book.reviews.at(-1)
  if (lastReview) return reviewNode(lastReview.chapterId)
  const ch = book.chapters.find((c) => c.id === chapterId) ?? book.chapters.at(-1)
  return ch ? reviewNode(ch.id) : 'outline'
}

export function workChapterId(node: ParsedNode, fallback = 'ch-4'): string {
  if (node.kind === 'chapter') return node.id
  if (node.kind === 'beats' || node.kind === 'draft' || node.kind === 'review') return node.chapterId
  return fallback
}

export function jumpNode(layer: LayerId, chapterId: string): DeskNodeId {
  switch (layer) {
    case 'pitch':
      return 'pitch'
    case 'canon':
      return 'canon'
    case 'bible':
      return 'bible'
    case 'outline':
      return 'outline'
    case 'volume':
      return 'vol-1'
    case 'unit':
      return 'unit-b'
    case 'chapter':
      return chapterId
    case 'beats':
      return beatsNode(chapterId)
    case 'draft':
      return draftNode(chapterId)
    case 'review':
      return reviewNode(chapterId)
  }
}

export function chapterHasStack(
  book: BookDemo,
  chapterId: string,
): { beats: boolean; draft: boolean; review: boolean } {
  return {
    beats: (book.beatsByChapter[chapterId] || []).length > 0,
    draft: book.drafts.some((d) => d.chapterId === chapterId),
    review: book.reviews.some((r) => r.chapterId === chapterId),
  }
}
