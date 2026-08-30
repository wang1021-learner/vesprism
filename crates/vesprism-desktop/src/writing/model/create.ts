/** 写台上当场新建实体。只改内存，不落盘。 */

import type {
  BeatCard,
  BookDemo,
  ChapterCard,
  ForeshadowRow,
  PersonCard,
  PersonRole,
  PlaceCard,
  RuleCard,
  UnitCard,
  VolumeCard,
} from './types'

function nextId(prefix: string, used: string[]): string {
  let n = 1
  while (used.includes(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

export function blankPerson(id: string, role: PersonRole): PersonCard {
  return {
    id,
    name: role === '主角' ? '主角' : '未命名',
    role,
    want: '',
    wound: '',
    secret: '',
    mustNotKnow: '',
    voice: '',
    voiceSample: '',
    relationToLead: role === '主角' ? '本人。' : '',
    stateAsOfChapter: 0,
    state: '',
    volumeArc: '',
  }
}

export function addPerson(book: BookDemo): { book: BookDemo; id: string } {
  const id = nextId('p-', book.people.map((p) => p.id))
  const role: PersonRole = book.people.some((p) => p.role === '主角') ? '工具' : '主角'
  const card = blankPerson(id, role)
  return { book: { ...book, people: [...book.people, card] }, id }
}

export function addRule(book: BookDemo): { book: BookDemo; id: string } {
  const id = nextId('rule-', book.rules.map((r) => r.id))
  const card: RuleCard = {
    id,
    name: '未命名规则',
    trigger: '',
    firstTwo: '',
    third: '',
    quota: '',
    quotaLeft: '',
    quotaAsOfChapter: 0,
    cannot: '',
    boundTo: '',
  }
  return { book: { ...book, rules: [...book.rules, card] }, id }
}

export function addPlace(book: BookDemo): { book: BookDemo; id: string } {
  const id = nextId('place-', book.places.map((p) => p.id))
  const card: PlaceCard = {
    id,
    name: '未命名地点',
    job: '',
    whoEnters: '',
    hides: '',
  }
  return { book: { ...book, places: [...book.places, card] }, id }
}

export function addVolume(book: BookDemo): { book: BookDemo; id: string } {
  const id = nextId('vol-', book.volumes.map((v) => v.id))
  const n = book.volumes.length + 1
  const card: VolumeCard = {
    id,
    title: `第${n}卷`,
    question: '',
    antagonist: '',
    rulePressure: '',
    campaigns: [],
    mustPay: [],
    mustNotPay: [],
    slap: '',
    climax: '',
    endChange: '',
    readerKnows: '',
    leadDoesNot: '',
    allyKnows: '',
  }
  return { book: { ...book, volumes: [...book.volumes, card] }, id }
}

export function addUnit(book: BookDemo, volumeId?: string): { book: BookDemo; id: string } {
  let next = book
  let volId = volumeId || next.volumes.at(-1)?.id
  if (!volId) {
    const created = addVolume(next)
    next = created.book
    volId = created.id
  }
  const id = nextId('unit-', next.units.map((u) => u.id))
  const n = next.units.filter((u) => u.volumeId === volId).length + 1
  const card: UnitCard = {
    id,
    volumeId: volId,
    name: `单元 ${n}`,
    chapters: '',
    campaign: '',
    win: '',
    antagonistMove: '',
    spent: '',
    infoPlan: '',
    endHook: '',
    peopleChange: '',
  }
  return { book: { ...next, units: [...next.units, card] }, id }
}

export function addChapter(book: BookDemo, unitId?: string): { book: BookDemo; id: string } {
  let next = book
  let uid = unitId || next.units.at(-1)?.id
  if (!uid) {
    const created = addUnit(next)
    next = created.book
    uid = created.id
  }
  const no = Math.max(0, ...next.chapters.map((c) => c.no)) + 1
  const id = `ch-${no}`
  const prev = next.chapters.reduce<ChapterCard | undefined>(
    (acc, c) => (!acc || c.no > acc.no ? c : acc),
    undefined,
  )
  const prevAdopted = prev ? next.reviews.some((r) => r.chapterId === prev.id && r.adopted) : true
  const locked = Boolean(prev) && !prevAdopted
  const card: ChapterCard = {
    id,
    no,
    title: '',
    unitId: uid,
    job: '推进',
    openHook: '',
    goal: '',
    resistance: '',
    turn: '',
    pleasure: '',
    infoGive: '',
    infoForbid: '',
    cast: [],
    plant: '',
    press: '',
    close: '',
    endHookKind: '',
    endHook: '',
    words: next.canon.chapterWords || '2000～2500',
    mood: '',
    platform: next.pitch.platform.includes('起点') ? 'qidian' : 'tomato',
    locked,
    lockReason: locked ? `第${prev!.no}章入卷尚未采纳，不准开下一章。` : '',
  }
  return { book: { ...next, chapters: [...next.chapters, card] }, id }
}

export function addBeat(book: BookDemo, chapterId: string): { book: BookDemo; id: string } {
  const existing = book.beatsByChapter[chapterId] || []
  const id = `${chapterId}-b${existing.length + 1}`
  const card: BeatCard = {
    id,
    title: `切块 ${existing.length + 1}`,
    scene: '',
    job: '',
    dialogue: '',
    info: '',
    mood: '',
    land: '',
  }
  return {
    book: {
      ...book,
      beatsByChapter: { ...book.beatsByChapter, [chapterId]: [...existing, card] },
    },
    id,
  }
}

export function addForeshadow(book: BookDemo): { book: BookDemo; id: string } {
  const used = new Set(book.outline.foreshadows.map((f) => f.id))
  let n = book.outline.foreshadows.length + 1
  let id = `F${String(n).padStart(3, '0')}`
  while (used.has(id)) {
    n += 1
    id = `F${String(n).padStart(3, '0')}`
  }
  const row: ForeshadowRow = {
    id,
    line: '',
    plantVolume: '',
    thisVolume: '',
    closeWhen: '',
    state: 'open',
  }
  return {
    book: {
      ...book,
      outline: { ...book.outline, foreshadows: [...book.outline.foreshadows, row] },
    },
    id,
  }
}

export function addCampaign(book: BookDemo, volumeId: string): BookDemo {
  return {
    ...book,
    volumes: book.volumes.map((v) => {
      if (v.id !== volumeId) return v
      const n = v.campaigns.length + 1
      return {
        ...v,
        campaigns: [
          ...v.campaigns,
          { id: `${v.id}-c${n}`, name: `战役 ${n}`, win: '', inState: '', outState: '' },
        ],
      }
    }),
  }
}

export function splitSlash(text: string): string[] {
  return text
    .split(/[/／]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function splitList(text: string): string[] {
  return text
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 出场栏：名字或 id 都解析成设定集 id，解析不到则原样保留。 */
export function resolveCastIds(book: BookDemo, tokens: unknown): string[] {
  const raw = Array.isArray(tokens)
    ? tokens.map((x) => String(x))
    : typeof tokens === 'string'
      ? splitSlash(tokens)
      : []
  return raw
    .map((token) => token.trim())
    .filter(Boolean)
    .map((t) => {
      const p = book.people.find((x) => x.name === t || x.id === t)
      if (p) return p.id
      const pl = book.places.find((x) => x.name === t || x.id === t)
      if (pl) return pl.id
      const r = book.rules.find((x) => x.name === t || x.id === t)
      if (r) return r.id
      return t
    })
}
