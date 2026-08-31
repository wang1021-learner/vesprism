/**
 * 写台「真实回写」纯函数：AI 产出 → 试笔草稿 / 检查单 / 补卡 / 入卷。
 * 不碰 store、不落盘，全部可单测。
 */
import { addChapter, addForeshadow, addPerson, addUnit, addVolume, resolveCastIds, splitSlash } from './create'
import { unnumberedIsEmpty } from './review-gate'
import type {
  BeatCard,
  BookDemo,
  ChapterCard,
  DraftPage,
  ForeshadowState,
  PitchCard,
  ReviewCard,
} from './types'
import { writeSlice, type WriteSlice } from './slice'

// ── 草稿：把 AI 回复按「【切块标题】正文」分块，映射回 slice.beats ──

export function parseDraftFromText(
  text: string,
  chapterId: string,
  slice: WriteSlice | null,
): DraftPage {
  const beats: BeatCard[] = slice?.beats ?? []
  const blocks: { beatId: string; body: string }[] = []
  const pushBlock = (beatId: string, body: string) => {
    const t = body.trim()
    if (!t) return
    blocks.push({ beatId, body: t })
  }

  const re = /【([^】]+)】/g
  let last = 0
  let m: RegExpExecArray | null
  let currentBeatId = beats[0]?.id ?? ''
  while ((m = re.exec(text))) {
    if (m.index > last) pushBlock(currentBeatId, text.slice(last, m.index))
    const title = m[1].trim()
    currentBeatId = beatIdForMarker(beats, title) ?? currentBeatId
    last = m.index + m[0].length
  }
  if (last < text.length) pushBlock(currentBeatId, text.slice(last))

  // 完全没有分块标记：整段归第一个切块（没有切块就挂空 beatId）
  if (blocks.length === 0) {
    const body = text.trim()
    if (body) blocks.push({ beatId: beats[0]?.id ?? '', body })
  }
  if (blocks.length === 0) blocks.push({ beatId: beats[0]?.id ?? '', body: '' })

  return { chapterId, accepted: false, beats: blocks }
}

function beatIdForMarker(beats: BeatCard[], title: string): string | undefined {
  const t = title.trim()
  if (!t) return undefined
  const exact = beats.find((b) => b.title === t)
  if (exact) return exact.id
  const numbered = /^(?:节拍|切块)\s*(\d+)(?:\s+(.+))?$/.exec(t)
  if (numbered) {
    const named = numbered[2]?.trim()
    if (named) {
      const hit = beats.find((b) => b.title === named)
      if (hit) return hit.id
    }
    const i = Number(numbered[1]) - 1
    if (i >= 0 && i < beats.length) return beats[i]?.id
  }
  const ends = beats.find((b) => b.title && t.endsWith(b.title))
  return ends?.id
}

/** 重写一块：优先取对应 beatId，只有一块无标记时用这一块。 */
export function draftBodyForBeat(draft: DraftPage, beatId: string, fallback: string): string {
  const hit = draft.beats.find((b) => b.beatId === beatId)
  if (hit?.body) return hit.body
  if (draft.beats.length === 1 && draft.beats[0]?.body) return draft.beats[0].body
  return fallback
}

/** 重写 / 洗这块：只覆盖选中 beat 的正文，不动节拍卡。 */
export function applyBeatBody(
  book: BookDemo,
  chapterId: string,
  beatId: string,
  text: string,
): BookDemo {
  if (!book.drafts.some((d) => d.chapterId === chapterId)) return book
  const slice = writeSlice(book, chapterId)
  const parsed = parseDraftFromText(text, chapterId, slice)
  const body = draftBodyForBeat(parsed, beatId, text.trim())
  return {
    ...book,
    drafts: book.drafts.map((d) =>
      d.chapterId === chapterId
        ? {
            ...d,
            beats: d.beats.map((bl) => (bl.beatId === beatId ? { ...bl, body } : bl)),
          }
        : d,
    ),
  }
}

/** upsert 某章的试笔草稿（未采纳） */
export function upsertDraft(book: BookDemo, draft: DraftPage): BookDemo {
  return {
    ...book,
    drafts: [...book.drafts.filter((d) => d.chapterId !== draft.chapterId), draft],
  }
}

// ── 检查单：AI 回复 JSON → ReviewCard（adopted 保持原值/默认 false） ──

const REVIEW_STRING_FIELDS = [
  'openHookOk',
  'goalOk',
  'endHookOk',
  'voiceLeak',
  'forbiddenKnow',
  'cheatAbuse',
  'dueSeen',
  'unnumbered',
  'summary80',
] as const

export function applyReviewFromJson(
  book: BookDemo,
  chapterId: string,
  json: Record<string, unknown>,
): BookDemo {
  const prev = book.reviews.find((r) => r.chapterId === chapterId)
  const card: ReviewCard = {
    chapterId,
    openHookOk: '',
    goalOk: '',
    endHookOk: '',
    voiceLeak: '',
    forbiddenKnow: '',
    cheatAbuse: '',
    dueSeen: '',
    unnumbered: '',
    states: [],
    foreshadow: [],
    summary80: '',
    adopted: prev?.adopted ?? false,
  }
  for (const k of REVIEW_STRING_FIELDS) {
    const v = json[k]
    if (typeof v === 'string') card[k] = v
  }
  if (Array.isArray(json.states)) {
    card.states = json.states.filter((x): x is string => typeof x === 'string')
  }
  if (Array.isArray(json.foreshadow)) {
    card.foreshadow = json.foreshadow.filter((x): x is string => typeof x === 'string')
  }
  return {
    ...book,
    reviews: [...book.reviews.filter((r) => r.chapterId !== chapterId), card],
  }
}

// ── 入卷：检查单写回案卷（人物当前态 + 伏线状态 + 解锁本章） ──

/** 解析 'id：值' 或 '名字：值' */
export function parseKeyedLine(s: string): { key: string; value: string } | null {
  const m = /^([^：:]+)[：:]\s*(.*)$/.exec(s.trim())
  if (!m) return null
  const key = m[1].trim()
  const value = m[2].trim()
  if (!key || !value) return null
  return { key, value }
}

export function lookupByIdThenName<T extends { id: string; name: string }>(
  xs: T[],
  key: string,
): T | undefined {
  return xs.find((x) => x.id === key) ?? xs.find((x) => x.name === key)
}

/** 解析 'F001：due → …' 或 'F001：已收。' → 状态关键词 */
function foreshadowStateFromNote(note: string, prev: string): string {
  if (/closed|已收|回收|收回/.test(note)) return 'closed'
  if (/due|到期/.test(note)) return 'due'
  if (/open|未收/.test(note)) return 'open'
  return prev
}

export function adoptIntoDossier(book: BookDemo, chapterId: string): BookDemo {
  const ch = book.chapters.find((c) => c.id === chapterId)
  const review = book.reviews.find((r) => r.chapterId === chapterId)
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!review || !draft?.accepted) return book
  if (!(review.summary80 || '').trim()) return book

  let next: BookDemo = {
    ...book,
    reviews: book.reviews.map((r) =>
      r.chapterId === chapterId ? { ...r, adopted: true } : r,
    ),
  }

  // 人物 / 规则 / 地点：优先 id，其次名字。只改对上的第一张。
  for (const s of review.states) {
    const parsed = parseKeyedLine(s)
    if (!parsed) continue
    const person = lookupByIdThenName(next.people, parsed.key)
    if (person) {
      next = {
        ...next,
        people: next.people.map((p) =>
          p.id === person.id
            ? { ...p, state: parsed.value, stateAsOfChapter: ch?.no ?? p.stateAsOfChapter }
            : p,
        ),
      }
      continue
    }
    const rule = lookupByIdThenName(next.rules, parsed.key)
    if (rule) {
      next = {
        ...next,
        rules: next.rules.map((r) =>
          r.id === rule.id
            ? { ...r, quotaLeft: parsed.value, quotaAsOfChapter: ch?.no ?? r.quotaAsOfChapter }
            : r,
        ),
      }
      continue
    }
    const place = lookupByIdThenName(next.places, parsed.key)
    if (place) {
      next = {
        ...next,
        places: next.places.map((p) => (p.id === place.id ? { ...p, whoEnters: parsed.value } : p)),
      }
    }
  }

  // 伏线状态：'F001：due → …'
  for (const f of review.foreshadow) {
    const m = /^(F\d+)[：:]\s*(.*)$/.exec(f.trim())
    if (!m) continue
    const row = next.outline.foreshadows.find((x) => x.id === m![1])
    if (!row) continue
    next = {
      ...next,
      outline: {
        ...next.outline,
        foreshadows: next.outline.foreshadows.map((x) =>
          x.id === row.id
            ? { ...x, state: foreshadowStateFromNote(m![2], x.state) as ForeshadowState }
            : x,
        ),
      },
    }
  }

  // 解锁下一章（本章写的时候已经是解锁的；未入卷的下一章保持锁）
  if (ch) {
    const nextNo = ch.no + 1
    next = {
      ...next,
      chapters: next.chapters.map((c) =>
        c.no === nextNo ? { ...c, locked: false, lockReason: '' } : c,
      ),
    }
  }
  return next
}

/** 把检查单里未编号的新埋编进伏笔表。不改 unnumbered 字段本身。 */
export function registerForeshadowsFromReview(book: BookDemo, chapterId: string): BookDemo {
  const ch = book.chapters.find((c) => c.id === chapterId)
  const review = book.reviews.find((r) => r.chapterId === chapterId)
  if (!review) return book
  const lines = review.unnumbered
    .split(/[\n；;]/)
    .map((s) => s.trim())
    .filter((s) => s && !unnumberedIsEmpty(s))
  let next = book
  for (const line of lines) {
    if (next.outline.foreshadows.some((f) => f.line === line)) continue
    const added = addForeshadow(next)
    next = {
      ...added.book,
      outline: {
        ...added.book.outline,
        foreshadows: added.book.outline.foreshadows.map((f) =>
          f.id === added.id
            ? {
                ...f,
                line,
                thisVolume: ch ? `第${ch.no}章` : f.thisVolume,
                state: 'open' as const,
              }
            : f,
        ),
      },
    }
  }
  return next
}

// ── 补卡：AI 回复 JSON 合并进目标卡（只覆盖非空字段） ──

export type FillCardTarget =
  | 'pitch'
  | 'canon'
  | 'lead'
  | 'outline'
  | 'volume'
  | 'unit'
  | 'chapter'
  | 'beats'

export const FILL_TARGET_LABEL: Record<FillCardTarget, string> = {
  pitch: '开卷卡',
  canon: '尺规卡',
  lead: '主角卡',
  outline: '总纲卡',
  volume: '卷纲卡',
  unit: '单元卡',
  chapter: '章纲卡',
  beats: '节拍卡',
}

export type FillScope = {
  chapterId?: string
  volumeId?: string
  unitId?: string
}

export function asFillScope(ref?: string | FillScope): FillScope {
  if (!ref) return {}
  if (typeof ref === 'string') return { chapterId: ref }
  return ref
}

/** 找到目标卡（不存在则当场新建）。卷/单元/章按当前节点，不默认打最后一张。 */
export function fillTargetOf(
  book: BookDemo,
  target: FillCardTarget,
  ref?: string | FillScope,
): { book: BookDemo; card: Record<string, unknown> } {
  const scope = asFillScope(ref)
  switch (target) {
    case 'pitch':
      return { book, card: book.pitch as unknown as Record<string, unknown> }
    case 'canon':
      return { book, card: book.canon as unknown as Record<string, unknown> }
    case 'lead': {
      const lead = book.people.find((p) => p.role === '主角')
      if (lead) return { book, card: lead as unknown as Record<string, unknown> }
      const added = addPerson(book)
      const card = added.book.people.find((p) => p.id === added.id)!
      return { book: added.book, card: card as unknown as Record<string, unknown> }
    }
    case 'outline':
      return { book, card: book.outline as unknown as Record<string, unknown> }
    case 'volume': {
      const vol = scope.volumeId
        ? book.volumes.find((v) => v.id === scope.volumeId)
        : book.volumes.at(-1)
      if (vol) return { book, card: vol as unknown as Record<string, unknown> }
      const added = addVolume(book)
      const card = added.book.volumes.find((v) => v.id === added.id)!
      return { book: added.book, card: card as unknown as Record<string, unknown> }
    }
    case 'unit': {
      if (scope.unitId) {
        const hit = book.units.find((u) => u.id === scope.unitId)
        if (hit) return { book, card: hit as unknown as Record<string, unknown> }
      }
      const inVol = scope.volumeId
        ? book.units.filter((u) => u.volumeId === scope.volumeId)
        : book.units
      const unit = inVol.at(-1)
      if (unit) return { book, card: unit as unknown as Record<string, unknown> }
      const added = addUnit(book, scope.volumeId)
      const card = added.book.units.find((u) => u.id === added.id)!
      return { book: added.book, card: card as unknown as Record<string, unknown> }
    }
    case 'chapter': {
      if (scope.chapterId) {
        const hit = book.chapters.find((c) => c.id === scope.chapterId)
        if (hit) return { book, card: hit as unknown as Record<string, unknown> }
      }
      if (scope.unitId) {
        const inUnit = book.chapters.filter((c) => c.unitId === scope.unitId)
        const last = inUnit.at(-1)
        if (last) return { book, card: last as unknown as Record<string, unknown> }
        const added = addChapter(book, scope.unitId)
        const card = added.book.chapters.find((c) => c.id === added.id)!
        return { book: added.book, card: card as unknown as Record<string, unknown> }
      }
      const last = book.chapters.at(-1)
      if (last) return { book, card: last as unknown as Record<string, unknown> }
      const added = addChapter(book)
      const card = added.book.chapters.find((c) => c.id === added.id)!
      return { book: added.book, card: card as unknown as Record<string, unknown> }
    }
    case 'beats': {
      const cid = scope.chapterId || book.chapters.at(-1)?.id
      if (!cid) return { book, card: {} }
      const existing = book.beatsByChapter[cid] || []
      if (existing.length > 0) {
        return { book, card: { chapterId: cid, beats: existing } }
      }
      const beats: BeatCard[] = [1, 2, 3].map((i) => ({
        id: `${cid}-b${i}`,
        title: `切块 ${i}`,
        scene: '',
        job: '',
        dialogue: '',
        info: '',
        mood: '',
        land: '',
      }))
      return {
        book: { ...book, beatsByChapter: { ...book.beatsByChapter, [cid]: beats } },
        card: { chapterId: cid, beats },
      }
    }
  }
}

/** 把 AI 的 JSON 合并进卡：非空字符串/数组覆盖，空值保留原样。 */
export function mergeJsonIntoCard(
  card: Record<string, unknown>,
  json: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...card }
  for (const [k, v] of Object.entries(json)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string') {
      const t = v.trim()
      if (t) next[k] = t
    } else if (Array.isArray(v)) {
      if (v.length > 0) next[k] = v
    } else if (typeof v === 'object') {
      next[k] = v
    } else {
      next[k] = v
    }
  }
  return next
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return splitSlash(v)
  return []
}

function normalizePitch(card: Record<string, unknown>, prev: PitchCard): PitchCard {
  const titles = card.titles != null ? asStringList(card.titles) : prev.titles
  let hooks: PitchCard['hooks'] = prev.hooks
  if (Array.isArray(card.hooks)) {
    hooks = [String(card.hooks[0] ?? ''), String(card.hooks[1] ?? ''), String(card.hooks[2] ?? '')]
  } else if (typeof card.hooks === 'string' && card.hooks.trim()) {
    const parts = splitSlash(card.hooks)
    hooks = [parts[0] ?? card.hooks.trim(), parts[1] ?? '', parts[2] ?? '']
  }
  let firstThree = prev.firstThree
  if (card.firstThree && typeof card.firstThree === 'object' && !Array.isArray(card.firstThree)) {
    const ft = card.firstThree as Record<string, unknown>
    firstThree = {
      ch1: String(ft.ch1 ?? prev.firstThree.ch1),
      ch2: String(ft.ch2 ?? prev.firstThree.ch2),
      ch3: String(ft.ch3 ?? prev.firstThree.ch3),
    }
  } else if (typeof card.firstThree === 'string' && card.firstThree.trim()) {
    firstThree = { ch1: card.firstThree.trim(), ch2: prev.firstThree.ch2, ch3: prev.firstThree.ch3 }
  }
  return {
    ...prev,
    ...card,
    titles,
    hooks,
    firstThree,
  } as PitchCard
}

/** 应用补卡结果回书（beats 特殊：整组替换） */
export function applyFillResult(
  book: BookDemo,
  target: FillCardTarget,
  card: Record<string, unknown>,
  ref?: string | FillScope,
): BookDemo {
  const scope = asFillScope(ref)
  if (target === 'beats') {
    const cid = scope.chapterId || book.chapters.at(-1)?.id
    if (!cid) return book
    const beats = Array.isArray(card.beats)
      ? (card.beats as Record<string, unknown>[]).map((b, i) => ({
          id: String(b.id ?? `${cid}-b${i + 1}`),
          title: String(b.title ?? `切块 ${i + 1}`),
          scene: String(b.scene ?? ''),
          job: String(b.job ?? ''),
          dialogue: String(b.dialogue ?? ''),
          info: String(b.info ?? ''),
          mood: String(b.mood ?? ''),
          land: String(b.land ?? ''),
        }))
      : null
    if (!beats || beats.length === 0) return book
    return {
      ...book,
      beatsByChapter: { ...book.beatsByChapter, [cid]: beats },
    }
  }
  if (target === 'pitch') return { ...book, pitch: normalizePitch(card, book.pitch) }
  if (target === 'canon') return { ...book, canon: { ...book.canon, ...card } as never }
  if (target === 'outline') return { ...book, outline: { ...book.outline, ...card } as never }
  if (target === 'lead') {
    const id = String(card.id ?? '')
    return {
      ...book,
      people: book.people.map((p) => (p.id === id ? ({ ...p, ...card } as never) : p)),
    }
  }
  if (target === 'volume') {
    const id = String(card.id ?? scope.volumeId ?? '')
    return {
      ...book,
      volumes: book.volumes.map((v) => (v.id === id ? ({ ...v, ...card } as never) : v)),
    }
  }
  if (target === 'unit') {
    const id = String(card.id ?? scope.unitId ?? '')
    return {
      ...book,
      units: book.units.map((u) => (u.id === id ? ({ ...u, ...card } as never) : u)),
    }
  }
  if (target === 'chapter') {
    const id = String(card.id ?? scope.chapterId ?? '')
    return {
      ...book,
      chapters: book.chapters.map((c) => {
        if (c.id !== id) return c
        const cast = 'cast' in card ? resolveCastIds(book, card.cast) : c.cast
        return { ...c, ...card, id, cast } as ChapterCard
      }),
    }
  }
  return book
}

/** 当前章若没有切块，先给一个可写的目标（writeSlice 需要 beats 可写） */
export function ensureWriteSlice(book: BookDemo, chapterId: string): BookDemo {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return book
  const existing = book.beatsByChapter[chapterId] || []
  if (existing.length > 0) return book
  const beats: BeatCard[] = [1, 2, 3].map((i) => ({
    id: `${chapterId}-b${i}`,
    title: `切块 ${i}`,
    scene: '',
    job: '',
    dialogue: '',
    info: '',
    mood: '',
    land: '',
  }))
  return {
    ...book,
    beatsByChapter: { ...book.beatsByChapter, [chapterId]: beats },
  }
}

export { writeSlice }
