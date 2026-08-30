import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { pushToast } from '../store'
import { BeatStrip } from './chrome/BeatStrip'
import { BookShelf } from './chrome/BookShelf'
import { BookTree } from './chrome/BookTree'
import { CandidatePanel } from './chrome/CandidatePanel'
import { CommandDock } from './chrome/CommandDock'
import { GateStrip } from './chrome/GateStrip'
import { DossierRail } from './chrome/DossierRail'
import { ModeStrip } from './chrome/ModeStrip'
import { SlicePanel } from './chrome/SlicePanel'
import { StepBanner } from './chrome/StepBanner'
import { DeskEdit, type PatchBook } from './fields/edit-ctx'
import { BibleIndex, PersonView, PlaceView, RuleView } from './layers/BibleView'
import { BeatsView } from './layers/BeatsView'
import { CanonView } from './layers/CanonView'
import { ChapterView } from './layers/ChapterView'
import { DraftView } from './layers/DraftView'
import { OutlineView } from './layers/OutlineView'
import { EngineView } from './layers/EngineView'
import { PitchView } from './layers/PitchView'
import { ReviewView } from './layers/ReviewView'
import { UnitView } from './layers/UnitView'
import { VolumeView } from './layers/VolumeView'
import { answerAsk, defaultVerb, gapLabel, landNode, verbsForStation } from './framework/station'
import type { StationVerb } from './framework/station'
import { chapterCountFor } from './framework/scale'
import {
  addBeat,
  addChapter,
  addForeshadow,
  addPerson,
  addPlace,
  addRule,
  addUnit,
  addVolume,
} from './model/create'
import { YANPIN_EYE } from './model/demo-yanpin'
import { emptyBook } from './model/empty-book'
import { gatesForNode } from './model/gates'
import { bookDossier } from './model/dossier'
import {
  beatsNode,
  jumpMode,
  modeOf,
  parseNode,
  personNode,
  placeNode,
  ruleNode,
  workChapterId,
} from './model/nodes'
import { writeSlice } from './model/slice'
import type { BookDemo, DeskNodeId } from './model/types'

type DraftFlag = { draftAccepted?: boolean; draftDiscarded?: boolean; reviewAdopted?: boolean }

function withFlags(book: BookDemo, flags: Record<string, DraftFlag>): BookDemo {
  return {
    ...book,
    drafts: book.drafts
      .filter((d) => !flags[d.chapterId]?.draftDiscarded)
      .map((d) => (flags[d.chapterId]?.draftAccepted ? { ...d, accepted: true } : d)),
    reviews: book.reviews.map((r) =>
      flags[r.chapterId]?.reviewAdopted ? { ...r, adopted: true } : r,
    ),
  }
}

function MainCard({
  node,
  book,
  onOpen,
  selectedBeatId,
  onSelectBeat,
  onAdopt,
  onDiscard,
  onAddPerson,
  onAddRule,
  onAddPlace,
  onAddBeat,
  onAddForeshadow,
}: {
  node: DeskNodeId
  book: BookDemo
  onOpen: (id: DeskNodeId) => void
  selectedBeatId?: string
  onSelectBeat?: (id: string) => void
  onAdopt?: () => void
  onDiscard?: () => void
  onAddPerson?: () => void
  onAddRule?: () => void
  onAddPlace?: () => void
  onAddBeat?: (chapterId: string) => void
  onAddForeshadow?: () => void
}) {
  const parsed = parseNode(node)
  if (parsed.kind === 'engine') {
    const chapterId = workChapterId(parsed, book.chapters.filter((c) => !c.locked).at(-1)?.id || 'ch-4')
    return <EngineView book={book} chapterId={chapterId} />
  }
  if (parsed.kind === 'pitch') return <PitchView card={book.pitch} />
  if (parsed.kind === 'canon') return <CanonView card={book.canon} />
  if (parsed.kind === 'bible') {
    return (
      <BibleIndex
        people={book.people}
        rules={book.rules}
        places={book.places}
        onOpen={onOpen}
        onAddPerson={onAddPerson}
        onAddRule={onAddRule}
        onAddPlace={onAddPlace}
      />
    )
  }
  if (parsed.kind === 'person') {
    const p = book.people.find((x) => x.id === parsed.id)
    return p ? <PersonView card={p} /> : null
  }
  if (parsed.kind === 'rule') {
    const r = book.rules.find((x) => x.id === parsed.id)
    return r ? <RuleView card={r} /> : null
  }
  if (parsed.kind === 'place') {
    const p = book.places.find((x) => x.id === parsed.id)
    return p ? <PlaceView card={p} /> : null
  }
  if (parsed.kind === 'outline') return <OutlineView card={book.outline} onAddForeshadow={onAddForeshadow} />
  if (parsed.kind === 'volume') {
    const v = book.volumes.find((x) => x.id === parsed.id)
    return v ? <VolumeView card={v} /> : null
  }
  if (parsed.kind === 'unit') {
    const u = book.units.find((x) => x.id === parsed.id)
    return u ? <UnitView card={u} /> : null
  }
  const chapterId =
    parsed.kind === 'chapter'
      ? parsed.id
      : parsed.kind === 'beats' || parsed.kind === 'draft' || parsed.kind === 'review'
        ? parsed.chapterId
        : ''
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return <PitchView card={book.pitch} />
  if (parsed.kind === 'beats') {
    return (
      <BeatsView
        chapter={ch}
        beats={book.beatsByChapter[ch.id] || []}
        onAddBeat={() => onAddBeat?.(ch.id)}
      />
    )
  }
  if (parsed.kind === 'draft') {
    return (
      <DraftView
        chapterNo={ch.no}
        title={ch.title}
        wordsBudget={ch.words}
        mood={ch.mood}
        draft={book.drafts.find((d) => d.chapterId === ch.id)}
        beats={book.beatsByChapter[ch.id] || []}
        selectedBeatId={selectedBeatId}
        onSelectBeat={onSelectBeat}
        onAdopt={onAdopt}
        onDiscard={onDiscard}
      />
    )
  }
  if (parsed.kind === 'review') {
    return <ReviewView chapterNo={ch.no} card={book.reviews.find((r) => r.chapterId === ch.id)} />
  }
  const castLabels = ch.cast
    .map((id) => {
      const p = book.people.find((x) => x.id === id)
      if (p) return p.name
      const pl = book.places.find((x) => x.id === id)
      if (pl) return pl.name
      const r = book.rules.find((x) => x.id === id)
      if (r) return r.name
      return id
    })
    .join(' / ')
  return <ChapterView card={ch} castLabels={castLabels} />
}

export function WritingDesk() {
  const [books, setBooks] = useState<BookDemo[]>([YANPIN_EYE])
  const [openId, setOpenId] = useState<string | null>(null)
  const [lastId, setLastId] = useState<string | null>(YANPIN_EYE.id)
  const [node, setNode] = useState<DeskNodeId>('pitch')
  const [selectedBeatId, setSelectedBeatId] = useState<string | undefined>()
  const [askReply, setAskReply] = useState<string | null>(null)
  const [flags, setFlags] = useState<Record<string, DraftFlag>>({})

  const raw = books.find((b) => b.id === openId)
  const book = useMemo(() => (raw ? withFlags(raw, flags) : undefined), [raw, flags])

  const openBook = (id: string) => {
    const next = books.find((b) => b.id === id)
    if (!next) return
    setOpenId(id)
    setLastId(id)
    setNode(landNode(next))
    setAskReply(null)
    setSelectedBeatId(undefined)
  }

  const createBook = (init: { title: string; platform: string; logline: string }) => {
    const next = emptyBook(init)
    setBooks((prev) => [...prev, next])
    setFlags({})
    setOpenId(next.id)
    setLastId(next.id)
    setNode('pitch')
    setAskReply(null)
  }

  const patch: PatchBook = (fn) => {
    if (!openId) return
    setBooks((prev) => prev.map((b) => (b.id === openId ? fn(b) : b)))
  }

  if (!book || !raw) {
    return (
      <BookShelf books={books} lastId={lastId} onOpen={openBook} onCreate={createBook} />
    )
  }

  return (
    <OpenDesk
      book={book}
      node={node}
      setNode={setNode}
      selectedBeatId={selectedBeatId}
      setSelectedBeatId={setSelectedBeatId}
      askReply={askReply}
      setAskReply={setAskReply}
      setFlags={setFlags}
      patch={patch}
      onClose={() => setOpenId(null)}
    />
  )
}

function OpenDesk({
  book,
  node,
  setNode,
  selectedBeatId,
  setSelectedBeatId,
  askReply,
  setAskReply,
  setFlags,
  patch,
  onClose,
}: {
  book: BookDemo
  node: DeskNodeId
  setNode: (id: DeskNodeId) => void
  selectedBeatId?: string
  setSelectedBeatId: (id: string | undefined) => void
  askReply: string | null
  setAskReply: (s: string | null) => void
  setFlags: Dispatch<SetStateAction<Record<string, DraftFlag>>>
  patch: PatchBook
  onClose: () => void
}) {
  const parsed = parseNode(node)
  const mode = modeOf(parsed)
  const chapterId = workChapterId(
    parsed,
    book.chapters.filter((c) => !c.locked).at(-1)?.id || book.chapters.at(-1)?.id || 'ch-4',
  )
  const gates = useMemo(() => gatesForNode(book, node), [book, node])
  const dossier = useMemo(() => bookDossier(book), [book])
  const slice = useMemo(() => writeSlice(book, chapterId), [book, chapterId])
  const showSlice = parsed.kind === 'chapter' || parsed.kind === 'beats' || parsed.kind === 'draft'
  const verbs = useMemo(() => verbsForStation(book, node), [book, node])
  const written = book.drafts.filter((d) => d.accepted).length
  const aim = chapterCountFor()
  const beats = chapterId ? book.beatsByChapter[chapterId] || [] : []
  const pct = aim > 0 ? Math.min(100, Math.round((written / aim) * 1000) / 10) : 0

  const patchChapter = (partial: DraftFlag) => {
    if (!chapterId) return
    setFlags((prev) => ({ ...prev, [chapterId]: { ...prev[chapterId], ...partial } }))
  }

  const goAdd = (
    factory: (b: BookDemo) => { book: BookDemo; id: string },
    to: (id: string) => DeskNodeId,
  ) => {
    let id = ''
    patch((b) => {
      const r = factory(b)
      id = r.id
      return r.book
    })
    if (id) setNode(to(id))
  }

  const onDispatch = (verb: StationVerb, extra: string, beatNo?: number) => {
    if (verb.id === 'ask') {
      setAskReply(answerAsk(book, extra))
      return
    }
    if (!verb.ok) {
      pushToast(verb.hint, 'info')
      return
    }
    if (verb.id === 'adopt-ledger') {
      patchChapter({ reviewAdopted: true })
      pushToast('已标记入卷（演示不落盘）。案卷数字仍未改。', 'info')
      return
    }
    if (verb.id === 'rewrite-span') {
      const beats = book.beatsByChapter[chapterId] || []
      const target =
        beatNo && beats[beatNo - 1]
          ? beats[beatNo - 1]
          : beats.find((b) => b.id === selectedBeatId)
      if (!target) {
        pushToast('先在稿纸上点一块。', 'info')
        return
      }
      setSelectedBeatId(target.id)
      pushToast(`将重写「${target.title}」${extra ? ` · ${extra}` : ''}。出试笔。演示未接会话。`, 'info')
      return
    }
    if (verb.id === 'write-chapter' || verb.id === 'fill-review') {
      pushToast(
        `将下达：${verb.label}${extra ? ` · ${extra}` : ''}。先试笔，不进正史。演示未接会话。`,
        'info',
      )
      return
    }
    pushToast(`将下达：${verb.label}${extra ? ` · ${extra}` : ''}。先试笔。演示未接会话。`, 'info')
  }

  return (
    <DeskEdit
      patch={patch}
      onAiFill={(label) =>
        pushToast(`AI 会按本栏契约填「${label}」，先试笔，不进正史。演示未接会话。`, 'info')
      }
    >
      <div className="wd-desk" role="main" aria-label="写台" data-layout="v2">
        <header className="wd-head">
          <button type="button" className="wd-btn wd-btn-ghost wd-back" onClick={onClose}>
            ← 书库
          </button>
          <div className="wd-title">
            <p className="wd-kicker">写完 · 百万字</p>
            <h1>{book.title}</h1>
          </div>
          <span className="wd-plat" title={book.pitch.platform}>
            {book.pitch.platform || '还没定平台'}
          </span>
          <p className="wd-head-note">{gapLabel(book)}</p>
          <div className="wd-spacer" />
          <div className="wd-dash">
            <div className="wd-ditem">
              <span className="wd-dn">
                {written}
                <em> / {aim}</em>
              </span>
              <span className="wd-dk">已进正史 · 章</span>
            </div>
            <div className="wd-dbar" aria-label={`进度 ${pct}%`}>
              <div className="wd-dbar-in" style={{ width: `${pct}%` }} />
            </div>
            <div className="wd-ditem">
              <span className="wd-save">已保存</span>
              <span className="wd-dk">本地 · 演示</span>
            </div>
          </div>
        </header>
        <ModeStrip current={mode} onJump={(m) => setNode(jumpMode(m, book, chapterId))} />
        <div className="wd-body">
          <BookTree
            book={book}
            selected={node}
            mode={mode}
            onSelect={setNode}
            onAddPerson={() => goAdd(addPerson, personNode)}
            onAddRule={() => goAdd(addRule, ruleNode)}
            onAddPlace={() => goAdd(addPlace, placeNode)}
            onAddVolume={() => goAdd(addVolume, (id) => id)}
            onAddUnit={() => goAdd((b) => addUnit(b), (id) => id)}
            onAddChapter={() => goAdd((b) => addChapter(b), (id) => id)}
          />
          <div className="wd-main">
            <StepBanner kind={parsed.kind} />
            <GateStrip gates={gates} />
            <BeatStrip beats={beats} selectedBeatId={selectedBeatId} onSelect={setSelectedBeatId} />
            <div className="wd-scroll">
              {showSlice && slice ? <SlicePanel slice={slice} /> : null}
              <MainCard
                node={node}
                book={book}
                onOpen={setNode}
                selectedBeatId={selectedBeatId}
                onSelectBeat={setSelectedBeatId}
                onAdopt={() => patchChapter({ draftAccepted: true })}
                onDiscard={() => patchChapter({ draftDiscarded: true })}
                onAddPerson={() => goAdd(addPerson, personNode)}
                onAddRule={() => goAdd(addRule, ruleNode)}
                onAddPlace={() => goAdd(addPlace, placeNode)}
                onAddBeat={(id) => goAdd((b) => addBeat(b, id), () => beatsNode(id))}
                onAddForeshadow={() => goAdd(addForeshadow, () => 'outline')}
              />
            </div>
            <div className="wd-dock">
              <CommandDock
                verbs={verbs}
                fallback={defaultVerb(book, node)}
                askReply={askReply}
                onClearAsk={() => setAskReply(null)}
                onDispatch={onDispatch}
              />
            </div>
          </div>
          <aside className="wd-rail" aria-label="试笔与案卷">
            <CandidatePanel />
            <DossierRail dossier={dossier} onOpen={setNode} />
          </aside>
        </div>
      </div>
    </DeskEdit>
  )
}
