import { defaultVerb } from '../framework/station'
import { parseNode } from './nodes'
import type { BookDemo, ChapterCard, DeskNodeId, Gate } from './types'

function filled(s: string | undefined): boolean {
  return Boolean((s || '').trim())
}

function beatsOf(book: BookDemo, chapterId: string) {
  return book.beatsByChapter[chapterId] || []
}

function reviewOf(book: BookDemo, chapterId: string) {
  return book.reviews.find((r) => r.chapterId === chapterId)
}

/** 全书层间门槛快照（演示书当前卡在第4章入卷）。只供展示。 */
export function gatesForBook(book: BookDemo): Gate[] {
  const pitch = book.pitch
  const canon = book.canon
  const lead = book.people.find((p) => p.role === '主角')
  const rule = book.rules[0]
  const vol = book.volumes[0]
  const unitB = book.units.find((u) => u.id === 'unit-b')
  const ch4 = book.chapters.find((c) => c.id === 'ch-4')
  const review = reviewOf(book, 'ch-4')

  return [
    {
      id: 'pitch-canon',
      from: '开卷',
      to: '尺规',
      ok: filled(pitch.cost) && filled(pitch.platform),
      need: '开卷必须有代价、有平台。',
    },
    {
      id: 'canon-bible',
      from: '尺规',
      to: '设定集',
      ok: filled(canon.powerCap) && filled(canon.narrativeBan),
      need: '尺规必须有力量上限和硬禁区。',
    },
    {
      id: 'bible-outline',
      from: '设定集',
      to: '总纲',
      ok: Boolean(lead && filled(lead.state) && rule && filled(rule.quota)),
      need: '主角要有当前态，规则要有代价。',
    },
    {
      id: 'outline-volume',
      from: '总纲',
      to: '卷纲',
      ok: Boolean(vol && vol.mustPay.length > 0),
      need: '本卷必须勾选要兑现的爽点。',
    },
    {
      id: 'volume-unit',
      from: '卷纲',
      to: '单元纲',
      ok: Boolean(unitB && filled(unitB.win)),
      need: '单元必须有胜负条件。',
    },
    {
      id: 'unit-chapter',
      from: '单元纲',
      to: '章纲',
      ok: Boolean(ch4 && filled(ch4.endHookKind)),
      need: '章纲必须有章末钩类型。',
    },
    {
      id: 'chapter-beats',
      from: '章纲',
      to: '节拍',
      ok: Boolean(ch4 && beatsOf(book, ch4.id).length >= 3),
      need: '节拍要对上章目标，至少 3 块。',
    },
    {
      id: 'beats-draft',
      from: '节拍',
      to: '正文',
      ok: Boolean(lead && lead.stateAsOfChapter >= 3 && beatsOf(book, 'ch-4').length >= 3),
      need: '人物当前态未过期，且节拍任务在。',
    },
    {
      id: 'draft-review',
      from: '正文',
      to: '入卷',
      ok: Boolean(review && !review.adopted),
      need: '正文写完才能入卷；未采纳不算过门槛。',
    },
    {
      id: 'review-next',
      from: '入卷',
      to: '下一章',
      ok: Boolean(review?.adopted),
      need: '没入卷（未采纳）不准开下一章。',
    },
  ]
}

function gate(
  id: string,
  from: string,
  to: string,
  ok: boolean,
  need: string,
): Gate {
  return { id, from, to, ok, need }
}

/** 当前节点相关的门槛。按所看的章计算节拍/入卷，不拿第4章去套第1章。 */
export function gatesForNode(book: BookDemo, nodeId: DeskNodeId): Gate[] {
  const parsed = parseNode(nodeId)
  const all = gatesForBook(book)

  if (parsed.kind === 'engine') return all
  if (parsed.kind === 'pitch') return all.filter((g) => g.id === 'pitch-canon')
  if (parsed.kind === 'canon') return all.filter((g) => g.id === 'canon-bible')
  if (parsed.kind === 'outline') return all.filter((g) => g.id === 'outline-volume')
  if (
    parsed.kind === 'bible' ||
    parsed.kind === 'person' ||
    parsed.kind === 'rule' ||
    parsed.kind === 'place'
  ) {
    return all.filter((g) => g.id === 'bible-outline')
  }
  if (parsed.kind === 'volume') return all.filter((g) => g.id === 'volume-unit')
  if (parsed.kind === 'unit') return all.filter((g) => g.id === 'unit-chapter')

  const chapterId =
    parsed.kind === 'chapter'
      ? parsed.id
      : parsed.kind === 'beats' || parsed.kind === 'draft' || parsed.kind === 'review'
        ? parsed.chapterId
        : ''
  const ch = book.chapters.find((c) => c.id === chapterId)
  const beats = chapterId ? beatsOf(book, chapterId) : []
  const review = chapterId ? reviewOf(book, chapterId) : undefined
  const hookOk = Boolean(ch && filled(ch.endHookKind))
  const beatsOk = beats.length >= 3
  const draftOk = Boolean(book.drafts.find((d) => d.chapterId === chapterId))
  const adopted = Boolean(review?.adopted)

  if (parsed.kind === 'chapter') {
    if (ch?.locked) {
      return [
        gate('review-next', '入卷', '下一章', false, ch.lockReason || '没入卷不准开下一章。'),
      ]
    }
    return [
      gate('unit-chapter', '单元纲', '章纲', hookOk, '章纲必须有章末钩类型。'),
      gate('chapter-beats', '章纲', '节拍', beatsOk, '节拍要对上章目标，至少 3 块。'),
    ]
  }
  if (parsed.kind === 'beats') {
    return [
      gate('chapter-beats', '章纲', '节拍', beatsOk, '节拍要对上章目标，至少 3 块。'),
      gate('beats-draft', '节拍', '正文', draftOk || beatsOk, '人物当前态未过期，且节拍任务在。'),
    ]
  }
  if (parsed.kind === 'draft') {
    return [
      gate('beats-draft', '节拍', '正文', draftOk, '有节拍才能写正文。'),
      gate('draft-review', '正文', '入卷', Boolean(review), '正文写完才能入卷。'),
    ]
  }
  if (parsed.kind === 'review') {
    return [
      gate('draft-review', '正文', '入卷', Boolean(review), '正文写完才能入卷。'),
      gate('review-next', '入卷', '下一章', adopted, '未采纳不准开下一章。'),
    ]
  }
  return all.slice(0, 2)
}

export function chapterGate(ch: ChapterCard | undefined): { canWrite: boolean; reason: string } {
  if (!ch) return { canWrite: false, reason: '没有章纲。' }
  if (ch.locked) return { canWrite: false, reason: ch.lockReason || '已锁。' }
  if (!ch.endHookKind) return { canWrite: false, reason: '章末钩类型为空。' }
  return { canWrite: true, reason: '' }
}

export function actionForNode(
  book: BookDemo,
  nodeId: DeskNodeId,
): { label: string; ok: boolean; hint: string } {
  const v = defaultVerb(book, nodeId)
  return { label: v.label, ok: v.ok, hint: v.hint }
}
