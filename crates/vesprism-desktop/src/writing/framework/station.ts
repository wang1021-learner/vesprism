/** 当前层缺什么，就露出哪些案头动作。写本章有硬门槛：书名、平台、一句话。 */

import { VERB_DOES } from './copy'
import { parseNode, type ParsedNode } from '../model/nodes'
import { chapterIsTomato, reviewBlocksAdopt } from '../model/review-gate'
import type { BookDemo, DeskNodeId } from '../model/types'

export type StationKind = 'write' | 'read'
export type StationCluster = 'write' | 'check' | 'ask'

export type StationVerb = {
  id: string
  label: string
  kind: StationKind
  cluster: StationCluster
  ok: boolean
  hint: string
  does: string
}

function filled(s: string | undefined): boolean {
  return Boolean((s || '').trim())
}

export function entryReady(book: BookDemo): boolean {
  const named =
    (book.title.trim() && book.title !== '未命名') || book.pitch.titles.some((t) => filled(t))
  return Boolean(named && filled(book.pitch.platform) && filled(book.pitch.logline))
}

export function pitchReady(book: BookDemo): boolean {
  return entryReady(book) && filled(book.pitch.cost)
}

export function canonReady(book: BookDemo): boolean {
  return filled(book.canon.powerCap) && filled(book.canon.narrativeBan)
}

export function leadReady(book: BookDemo): boolean {
  const lead = book.people.find((p) => p.role === '主角')
  return Boolean(lead && filled(lead.state) && filled(lead.mustNotKnow))
}

export function beatsReady(book: BookDemo, chapterId: string): boolean {
  return (book.beatsByChapter[chapterId] || []).length >= 3
}

function chapterOf(book: BookDemo, parsed: ParsedNode) {
  if (parsed.kind === 'chapter') return book.chapters.find((c) => c.id === parsed.id)
  if (parsed.kind === 'beats' || parsed.kind === 'draft' || parsed.kind === 'review') {
    return book.chapters.find((c) => c.id === parsed.chapterId)
  }
  return undefined
}

function askVerb(): StationVerb {
  return {
    id: 'ask',
    label: '查设定',
    kind: 'read',
    cluster: 'ask',
    ok: true,
    hint: '只读。不写回设定，不改当前态。',
    does: VERB_DOES.ask,
  }
}

function verb(
  id: string,
  label: string,
  ok: boolean,
  hint: string,
  kind: StationKind = 'write',
  cluster: StationCluster = 'write',
): StationVerb {
  return { id, label, kind, cluster, ok, hint, does: VERB_DOES[id] ?? hint }
}

export function writeChapterGate(book: BookDemo, chapterId: string): { ok: boolean; hint: string } {
  if (!entryReady(book)) {
    return { ok: false, hint: '没有书名、平台、一句话卖点，不准写本章。' }
  }
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return { ok: false, hint: '没有章纲。' }
  if (ch.locked) return { ok: false, hint: ch.lockReason || '已锁。' }
  if (chapterIsTomato(book, ch) && !filled(ch.openHook)) {
    return { ok: false, hint: '番茄章开场钩必须是物理事件，不能空着。' }
  }
  if (!ch.endHookKind) return { ok: false, hint: '章纲必须有章末钩类型。' }
  if (!beatsReady(book, ch.id)) return { ok: false, hint: '节拍要对上章目标，至少 3 块。' }
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (draft?.accepted) {
    return { ok: false, hint: '已进正史。要重写先退回试笔。' }
  }
  return { ok: true, hint: '点「写这一章」。先试笔，点进正史才作数。' }
}

/** 打开书时停在当前缺卡或未采纳试笔。 */
export function landNode(book: BookDemo): DeskNodeId {
  if (!pitchReady(book)) return 'pitch'
  if (!canonReady(book)) return 'canon'
  if (!leadReady(book)) return 'bible'
  if (!filled(book.outline.causality)) return 'outline'
  const unadoptedDraft = book.drafts.find((d) => !d.accepted)
  if (unadoptedDraft) return `${unadoptedDraft.chapterId}:draft`
  const unadoptedReview = book.reviews.find((r) => !r.adopted)
  if (unadoptedReview) return `${unadoptedReview.chapterId}:review`
  const locked = book.chapters.find((c) => c.locked)
  if (locked) {
    const prev = book.chapters.find((c) => c.no === locked.no - 1)
    if (prev) return `${prev.id}:review`
  }
  const last = [...book.chapters].reverse().find((c) => !c.locked)
  return last?.id ?? 'pitch'
}

export function gapLabel(book: BookDemo): string {
  if (!entryReady(book)) return '还差书名、平台或一句话，不能写正文'
  if (!pitchReady(book)) return '卖点还没写代价，补开卷'
  if (!canonReady(book)) return '规矩还空，先起草力量上限和禁区'
  if (!leadReady(book)) return '主角还没有当前态'
  const unadopted = book.drafts.find((d) => !d.accepted)
  if (unadopted) {
    const ch = book.chapters.find((c) => c.id === unadopted.chapterId)
    return `第${ch?.no ?? '?'}章还在试笔，没点进正史`
  }
  const review = book.reviews.find((r) => !r.adopted)
  if (review) {
    const ch = book.chapters.find((c) => c.id === review.chapterId)
    return `第${ch?.no ?? '?'}章检查还没入卷`
  }
  return '这一步可以下令'
}

export function washSpanGate(
  book: BookDemo,
  chapterId: string,
  selectedBeatId?: string,
): { ok: boolean; hint: string } {
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!draft) return { ok: false, hint: '还没有试笔稿纸。' }
  if (draft.accepted) return { ok: false, hint: '要洗先退回试笔。' }
  const beats = book.beatsByChapter[chapterId] || []
  if (!selectedBeatId || !beats.some((b) => b.id === selectedBeatId)) {
    return { ok: false, hint: '先在稿纸上点一块。' }
  }
  return { ok: true, hint: '只改这一块的套话，情节不动。' }
}

export function verbsForStation(
  book: BookDemo,
  nodeId: DeskNodeId,
  selectedBeatId?: string,
): StationVerb[] {
  const parsed = parseNode(nodeId)
  const ch = chapterOf(book, parsed)
  const chapterId = ch?.id || ''
  const write = writeChapterGate(book, chapterId)
  const draft = chapterId ? book.drafts.find((d) => d.chapterId === chapterId) : undefined
  const review = chapterId ? book.reviews.find((r) => r.chapterId === chapterId) : undefined
  const ask = askVerb()

  if (parsed.kind === 'pitch') {
    if (!pitchReady(book)) {
      return [
        verb('fill-pitch', '补全开卷', true, '先把开卷卡缺的字段补齐。'),
        ask,
      ]
    }
    return [
      verb('write-canon', '起草规矩', !canonReady(book), canonReady(book) ? '规矩已经有了。' : '卖点在，起草规矩。'),
      ask,
    ]
  }
  if (parsed.kind === 'canon') {
    if (!canonReady(book)) {
      return [verb('write-canon', '起草规矩', true, '规矩还空，先起草。'), ask]
    }
    return [
      verb('fill-lead', '写主角卡', !leadReady(book), leadReady(book) ? '主角已有当前态。' : '规矩在，写主角卡。'),
      ask,
    ]
  }
  if (
    parsed.kind === 'bible' ||
    parsed.kind === 'person' ||
    parsed.kind === 'rule' ||
    parsed.kind === 'place'
  ) {
    if (!leadReady(book)) {
      return [verb('fill-lead', '写主角卡', true, '主角要有当前态和不能知道的。'), ask]
    }
    return [verb('split-outline', '拆长线', true, '设定在，拆长线。'), ask]
  }
  if (parsed.kind === 'outline') {
    return [verb('split-volume', '拆这一卷', book.volumes.length > 0 || filled(book.outline.causality), '长线在，拆这一卷。'), ask]
  }
  if (parsed.kind === 'volume') {
    return [verb('split-unit', '拆这几章', true, '卷纲在，拆战役。'), ask]
  }
  if (parsed.kind === 'unit') {
    return [verb('split-chapter', '写章纲', true, '单元在，写这一章纲。'), ask]
  }

  if (
    parsed.kind === 'chapter' ||
    parsed.kind === 'beats' ||
    parsed.kind === 'draft' ||
    parsed.kind === 'review'
  ) {
    const tomatoHook = ch && (!chapterIsTomato(book, ch) || filled(ch.openHook))
    const washable = Boolean(draft && !draft.accepted)
    const blocks =
      review && draft?.accepted ? reviewBlocksAdopt(book, chapterId) : { ok: false, hints: [] as string[] }
    const list: StationVerb[] = [
      verb('split-chapter', '写章纲', Boolean(ch), ch ? '按单元写本章纲。' : '没有章。'),
      verb(
        'split-beats',
        '把这章切开',
        Boolean(ch?.endHookKind) && Boolean(tomatoHook),
        !ch?.endHookKind
          ? '章末钩类型为空。'
          : !tomatoHook
            ? '番茄章开场钩必须是物理事件，不能空着。'
            : '按章纲切成可写的块。',
      ),
      verb('write-chapter', '写这一章', write.ok, write.hint),
      verb('rewrite-span', '重写这一块', Boolean(draft), draft ? '先在稿纸上点一块。' : '还没有试笔稿纸。'),
      verb(
        'wash-span',
        '洗这块',
        washable,
        washable ? '只改这一块的套话，情节不动。' : washSpanGate(book, chapterId, selectedBeatId).hint,
      ),
      verb(
        'fill-review',
        '检查这一章',
        Boolean(draft),
        draft ? '对照章纲和设定。' : '没有正文可检查。',
        'write',
        'check',
      ),
      verb(
        'adopt-ledger',
        '入卷',
        Boolean(review && !review.adopted && draft?.accepted && blocks.ok),
        review?.adopted
          ? '已经入卷。'
          : !draft?.accepted
            ? '先把试笔采纳进正史，再入卷。'
            : !review
              ? '先检查，再入卷。'
              : !blocks.ok
                ? blocks.hints[0] || '检查红项未过。'
                : '确认后才改当前态和伏线。',
        'write',
        'check',
      ),
    ]
    if (parsed.kind === 'review' && review?.adopted) {
      const hasSummary = filled(review.summary80)
      list.push(
        verb(
          'split-next',
          '开下一章',
          hasSummary,
          hasSummary ? '已经入卷，可以开下一章。' : '入卷需要 80 字摘要。',
        ),
      )
    }
    const body = chapterId ? (book.drafts.find((d) => d.chapterId === chapterId)?.beats ?? [])
      .map((b) => b.body)
      .join('\n')
      .trim() : ''
    list.push(
      verb(
        'export-chapter',
        '导出这一章',
        Boolean(body),
        body ? '导出本章正文为 txt。' : '这一章还没有正文。',
        'read',
        'ask',
      ),
    )
    list.push(ask)
    return list
  }

  const gap = landNode(book)
  return verbsForStation(book, gap)
}

function preferredVerbId(book: BookDemo, parsed: ParsedNode): string {
  if (parsed.kind === 'pitch') return pitchReady(book) ? 'write-canon' : 'fill-pitch'
  if (parsed.kind === 'canon') return canonReady(book) ? 'fill-lead' : 'write-canon'
  if (
    parsed.kind === 'bible' ||
    parsed.kind === 'person' ||
    parsed.kind === 'rule' ||
    parsed.kind === 'place'
  ) {
    return leadReady(book) ? 'split-outline' : 'fill-lead'
  }
  if (parsed.kind === 'outline') return 'split-volume'
  if (parsed.kind === 'volume') return 'split-unit'
  if (parsed.kind === 'unit') return 'split-chapter'
  if (parsed.kind === 'beats') return 'write-chapter'
  if (parsed.kind === 'chapter') return 'write-chapter'
  if (parsed.kind === 'draft') {
    const draft = book.drafts.find((d) => d.chapterId === parsed.chapterId)
    if (draft) return 'fill-review'
    return 'write-chapter'
  }
  if (parsed.kind === 'review') {
    const review = book.reviews.find((r) => r.chapterId === parsed.chapterId)
    return review?.adopted ? 'split-next' : 'adopt-ledger'
  }
  return 'fill-pitch'
}

export function defaultVerb(book: BookDemo, nodeId: DeskNodeId): StationVerb {
  const parsed = parseNode(nodeId)
  const verbs = verbsForStation(book, nodeId)
  const prefer = preferredVerbId(book, parsed)
  const hit = verbs.find((v) => v.id === prefer)
  if (hit) return hit
  return verbs.find((v) => v.kind === 'write' && v.ok) ?? verbs.find((v) => v.kind === 'write') ?? verbs[0] ?? askVerb()
}

export function answerAsk(book: BookDemo, query: string): string {
  const q = query.trim()
  if (!q) return '问谁、哪条规则、哪条伏线。只读，不写回设定集。'
  const person = book.people.find((p) => q.includes(p.name))
  if (person) {
    return `${person.name}（${person.role}）当前态截止第${person.stateAsOfChapter}章：${person.state}\n不能知道：${person.mustNotKnow}\n只读。不会写回设定。`
  }
  const rule = book.rules.find((r) => q.includes(r.name))
  if (rule) {
    return `${rule.name} 配额：${rule.quota}\n不能：${rule.cannot}\n只读。不会写回设定。`
  }
  const foil = book.outline.foreshadows.find((f) => q.includes(f.id) || q.includes(f.line.slice(0, 4)))
  if (foil) {
    return `${foil.id} ${foil.line} · ${foil.state}\n本卷：${foil.thisVolume}\n只读。不会改伏线案卷。`
  }
  return `没有在设定集里点到「${q}」。只读查询，不会改设定。`
}
