import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $defaultModelId,
  $generating,
  $messages,
  $reasoningEffort,
  getTabState,
  looksAbsolutePath,
  normPathKey,
  patchTab,
  pushToast,
} from '../store'
import { isTauriRuntime, restartSession, setSessionMode, startSession } from '../bridge'
import { cancelActiveTurn } from '../lib/cancelActiveTurn'
import { sendSessionPrompt } from '../lib/sendSessionPrompt'
import { BeatStrip } from './chrome/BeatStrip'
import { BookTree } from './chrome/BookTree'
import { ChapterIndex } from './chrome/ChapterIndex'
import { CandidatePanel } from './chrome/CandidatePanel'
import { CommandDock } from './chrome/CommandDock'
import { DossierRail } from './chrome/DossierRail'
import { GateStrip } from './chrome/GateStrip'
import { ModeStrip } from './chrome/ModeStrip'
import { SlicePanel } from './chrome/SlicePanel'
import { StepBanner } from './chrome/StepBanner'
import { DeskEdit, type PatchBook } from './fields/edit-ctx'
import { BibleIndex, PersonView, PlaceView, RuleView } from './layers/BibleView'
import { BeatsView } from './layers/BeatsView'
import { CanonView } from './layers/CanonView'
import { ChapterView } from './layers/ChapterView'
import { DraftView } from './layers/DraftView'
import { EngineView } from './layers/EngineView'
import { OutlineView } from './layers/OutlineView'
import { PitchView } from './layers/PitchView'
import { ReviewView } from './layers/ReviewView'
import { UnitView } from './layers/UnitView'
import { VolumeView } from './layers/VolumeView'
import { answerAsk, defaultVerb, gapLabel, landNode, washSpanGate, verbsForStation, type StationVerb } from './framework/station'
import {
  assembleWriteChapter,
  assistantTextAfter,
  extractJson,
  fillCardUser,
  lastTaskUser,
  reviewerJsonHint,
  reviewerSystem,
  reviewerUser,
  rewriteUser,
  splitterSystem,
  taskWire,
  washerSystem,
  washUser,
  writerSystem,
} from './framework/prompt'
import {
  FILL_TARGET_LABEL,
  adoptIntoDossier,
  applyBeatBody,
  applyFillResult,
  applyReviewFromJson,
  asFillScope,
  fillTargetOf,
  mergeJsonIntoCard,
  parseDraftFromText,
  registerForeshadowsFromReview,
  upsertDraft,
  type FillCardTarget,
  type FillScope,
} from './model/apply'
import { reviewBlocksAdopt, styleHits, wordCountNotes } from './model/review-gate'
import {
  WRITING_SESSION_MODE,
  needsFreshSession,
  sessionReady,
  taskBelongsToBook,
  waitUntil,
} from './isolate'
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
import { bookDossier } from './model/dossier'
import {
  $writingBooks,
  $writingLoaded,
  $writingOpenId,
  bootWritingLibrary,
  mapWritingBooks,
  rememberLastBook,
} from './library'
import { gatesForNode } from './model/gates'
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
import { acceptedChars, chapterCountFor, countHanzi, parseChapterWords, remainToTarget, volumeLandLine } from './framework/scale'
import { persistBook, writingExportBook, writingSessionCwd } from './storage'

/** 写台任务：发给引擎的一个动词（回合并按 TASK 标记归属） */
type DeskTask = {
  bookId: string
} & (
  | { kind: 'write-chapter'; chapterId: string }
  | { kind: 'finish-chapter'; chapterId: string }
  | { kind: 'fill-review'; chapterId: string }
  | { kind: 'rewrite'; chapterId: string; beatId: string }
  | { kind: 'wash'; chapterId: string; beatId: string }
  | { kind: 'fill-card'; target: FillCardTarget; chapterId?: string; scope?: FillScope }
)

function MainCard({
  node,
  book,
  onOpen,
  selectedBeatId,
  onSelectBeat,
  onAdopt,
  onDiscard,
  onRevert,
  onAddPerson,
  onAddRule,
  onAddPlace,
  onAddBeat,
  onAddForeshadow,
  reviewBlocks,
  styleNotes,
  onRegisterUnnumbered,
}: {
  node: DeskNodeId
  book: BookDemo
  onOpen: (id: DeskNodeId) => void
  selectedBeatId?: string
  onSelectBeat?: (id: string) => void
  onAdopt?: () => void
  onDiscard?: () => void
  onRevert?: () => void
  onAddPerson?: () => void
  onAddRule?: () => void
  onAddPlace?: () => void
  onAddBeat?: (chapterId: string) => void
  onAddForeshadow?: () => void
  reviewBlocks?: string[]
  styleNotes?: string[]
  onRegisterUnnumbered?: () => void
}) {
  const parsed = parseNode(node)
  if (parsed.kind === 'engine') {
    const chapterId = workChapterId(
      parsed,
      book.chapters.filter((c) => !c.locked).at(-1)?.id || book.chapters.at(-1)?.id || '',
    )
    return <EngineView book={book} chapterId={chapterId} onOpen={onOpen} />
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
  if (parsed.kind === 'outline') {
    return (
      <>
        <OutlineView card={book.outline} onAddForeshadow={onAddForeshadow} />
        <ChapterIndex book={book} onOpen={onOpen} />
      </>
    )
  }
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
        chapterWords={book.canon.chapterWords}
        mood={ch.mood}
        draft={book.drafts.find((d) => d.chapterId === ch.id)}
        beats={book.beatsByChapter[ch.id] || []}
        selectedBeatId={selectedBeatId}
        onSelectBeat={onSelectBeat}
        onAdopt={onAdopt}
        onDiscard={onDiscard}
        onRevert={onRevert}
      />
    )
  }
  if (parsed.kind === 'review') {
    return (
      <ReviewView
        chapterNo={ch.no}
        card={book.reviews.find((r) => r.chapterId === ch.id)}
        blocks={reviewBlocks}
        styleNotes={styleNotes}
        wordNotes={wordCountNotes(book, ch.id)}
        onRegisterUnnumbered={onRegisterUnnumbered}
      />
    )
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
  const whereLabels = (ch.where || [])
    .map((id) => book.places.find((x) => x.id === id)?.name || id)
    .join(' / ')
  return <ChapterView card={ch} castLabels={castLabels} whereLabels={whereLabels} />
}

export function WritingDesk() {
  const tabId = useStore($activeTabId)
  const generating = useStore($generating)
  const modelId = useStore($defaultModelId)
  const effort = useStore($reasoningEffort)

  const books = useStore($writingBooks)
  const loaded = useStore($writingLoaded)
  const openId = useStore($writingOpenId)
  const [node, setNode] = useState<DeskNodeId>('pitch')
  const [selectedBeatId, setSelectedBeatId] = useState<string | undefined>()
  const [askReply, setAskReply] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const saveTimer = useRef<number | undefined>(undefined)
  const latestByBookRef = useRef<Map<string, BookDemo>>(new Map())
  const pendingTaskRef = useRef<DeskTask | null>(null)
  const reconciledRef = useRef(false)
  const openIdRef = useRef<string | null>(null)
  openIdRef.current = openId

  const book = useMemo(() => books.find((b) => b.id === openId), [books, openId])

  // ── 持久化：每书一份待写快照；切书先冲刷上一本，禁止共用一个 timer 把 A 冲成 B ──
  const flushSave = (b: BookDemo) => {
    latestByBookRef.current.set(b.id, b)
    setSaveState('saving')
    void persistBook(b)
      .then(() => {
        if (openIdRef.current === b.id) setSaveState('saved')
      })
      .catch((e) => {
        if (openIdRef.current === b.id) setSaveState('error')
        pushToast(`保存失败：${String(e)}`, 'error')
      })
  }
  const flushBookNow = (id: string | null | undefined) => {
    if (!id) return
    const pending = latestByBookRef.current.get(id)
    if (!pending) return
    window.clearTimeout(saveTimer.current)
    flushSave(pending)
  }
  const scheduleSave = (b: BookDemo) => {
    latestByBookRef.current.set(b.id, b)
    window.clearTimeout(saveTimer.current)
    const id = b.id
    saveTimer.current = window.setTimeout(() => {
      const pending = latestByBookRef.current.get(id)
      if (pending) flushSave(pending)
    }, 400)
  }
  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current)
      for (const pending of latestByBookRef.current.values()) {
        void persistBook(pending).catch(() => {})
      }
    }
  }, [])

  const patch: PatchBook = (fn) => {
    if (!openId) return
    mapWritingBooks((prev) =>
      prev.map((b) => {
        if (b.id !== openId) return b
        const next = fn(b)
        scheduleSave(next)
        return next
      }),
    )
  }

  // ── 会话：每书一个工作目录；切到 ask（只答、无工具），避免模型去写文件 ──
  const lockAskMode = async (): Promise<boolean> => {
    if (!tabId) return false
    try {
      await setSessionMode(tabId, WRITING_SESSION_MODE)
      patchTab(tabId, { sessionMode: 'ask' })
      return true
    } catch (e) {
      pushToast(`写台没切到只答模式（无工具）：${String(e)}`, 'error')
      return false
    }
  }

  const ensureBookSession = async (b: BookDemo, fresh = false): Promise<boolean> => {
    if (!tabId) return false
    try {
      const cwd = await writingSessionCwd(b.id)
      const st = getTabState(tabId)
      const sameCwd = Boolean(
        st && looksAbsolutePath(st.cwd) && normPathKey(st.cwd) === normPathKey(cwd),
      )
      const readyNow = sessionReady({ sessionId: st?.sessionId, phase: st?.phase })
      if (sameCwd && readyNow && (!fresh || (st?.messages.length ?? 0) === 0)) {
        if (st?.sessionMode === 'ask') return true
        return lockAskMode()
      }
      patchTab(tabId, {
        messages: [],
        phase: 'booting',
        status: 'idle',
        error: '',
        permission: null,
        userQuestion: null,
        mcpElicit: null,
      })
      const opts = { modelId: modelId || undefined, reasoningEffort: effort || undefined }
      if (st?.sessionId) {
        await restartSession(tabId, cwd, opts)
      } else {
        await startSession(tabId, cwd, opts)
      }
      patchTab(tabId, { cwd, phase: 'ready', status: 'idle' })
      const ok = await waitUntil(() => Boolean(getTabState(tabId)?.sessionId))
      if (!ok) {
        pushToast('写台会话还没拿到 session，稍后再点。', 'error')
        return false
      }
      return lockAskMode()
    } catch (e) {
      pushToast(`写台会话启动失败：${String(e)}`, 'error')
      return false
    }
  }

  // ── 启动：侧栏和写台共用书库 ──
  useEffect(() => {
    void bootWritingLibrary()
  }, [])

  const prevOpenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!loaded) return
    if (!openId) {
      if (prevOpenRef.current) flushBookNow(prevOpenRef.current)
      prevOpenRef.current = null
      return
    }
    const next = books.find((b) => b.id === openId)
    if (!next) return
    const prev = prevOpenRef.current
    if (prev === openId) return
    if (prev) {
      flushBookNow(prev)
      pendingTaskRef.current = null
      reconciledRef.current = false
      if (tabId && generating) void cancelActiveTurn(tabId)
      if (tabId) {
        patchTab(tabId, {
          messages: [],
          permission: null,
          userQuestion: null,
          mcpElicit: null,
        })
      }
    }
    prevOpenRef.current = openId
    setNode(landNode(next))
    setAskReply(null)
    setSelectedBeatId(undefined)
    void ensureBookSession(next, Boolean(prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, openId, books])

  // ── 任务：回合收集（generating → idle 边沿） ──
  const applyTaskText = (task: DeskTask, text: string) => {
    if (task.bookId !== openIdRef.current) {
      pushToast('已切书，上一本的产出没有写入当前书。', 'info')
      return
    }
    if (!book || book.id !== task.bookId) return
    if (task.kind === 'write-chapter' || task.kind === 'finish-chapter') {
      patch((b) => {
        const slice = writeSlice(b, task.chapterId)
        let next = upsertDraft(b, parseDraftFromText(text, task.chapterId, slice))
        if (task.kind === 'finish-chapter') {
          next = {
            ...next,
            drafts: next.drafts.map((d) =>
              d.chapterId === task.chapterId ? { ...d, accepted: true } : d,
            ),
          }
        }
        return next
      })
      if (task.kind === 'finish-chapter') {
        setNode(`${task.chapterId}:review`)
        pushToast('试笔已进正史，正在检查。入卷仍要你确认。', 'success')
        const latest = latestByBookRef.current.get(task.bookId)
        const user = latest ? reviewerUser(latest, task.chapterId) : null
        if (user) {
          void runTask(
            { kind: 'fill-review', chapterId: task.chapterId, bookId: task.bookId },
            reviewerSystem(),
            `${user}\n\n${reviewerJsonHint()}`,
          )
        }
        return
      }
      setNode(`${task.chapterId}:draft`)
      pushToast('试笔完成。可在稿纸上改，或点「采纳进正史」。', 'success')
      return
    }
    if (task.kind === 'fill-review') {
      const json = extractJson(text)
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        pushToast('这轮检查没解析出 JSON 检查单，请稍后手动填。', 'error')
        return
      }
      patch((b) => applyReviewFromJson(b, task.chapterId, json as Record<string, unknown>))
      setNode(`${task.chapterId}:review`)
      pushToast('检查单已填，确认后点「入卷」。', 'success')
      return
    }
    if (task.kind === 'rewrite' || task.kind === 'wash') {
      let wrote = false
      patch((b) => {
        if (!b.drafts.some((d) => d.chapterId === task.chapterId)) return b
        wrote = true
        return applyBeatBody(b, task.chapterId, task.beatId, text)
      })
      const okMsg = task.kind === 'wash' ? '这一块已去掉套话。' : '这一块已重写。'
      const miss = task.kind === 'wash' ? '还没有试笔稿纸，无法洗。' : '还没有试笔稿纸，无法重写。'
      pushToast(wrote ? okMsg : miss, wrote ? 'success' : 'info')
      return
    }
    if (task.kind === 'fill-card') {
      const json = extractJson(text)
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        pushToast('补卡输出不是 JSON，未应用。可手动填。', 'error')
        return
      }
      patch((b) => {
        const scope = task.scope || { chapterId: task.chapterId }
        const current = fillTargetOf(b, task.target, scope)
        const merged = mergeJsonIntoCard(current.card, json as Record<string, unknown>)
        return applyFillResult(current.book, task.target, merged, scope)
      })
      pushToast('已按 AI 补全，可在卡上继续改。', 'success')
      return
    }
  }

  const applyTaskOutput = (task: DeskTask) => {
    if (task.bookId !== openIdRef.current) {
      pushToast('已切书，上一本的产出没有写入当前书。', 'info')
      return
    }
    const now = (tabId ? getTabState(tabId)?.messages : null) ?? $messages.get()
    const found = lastTaskUser(now)
    if (!found || found.kind !== task.kind || !taskBelongsToBook(found, task.bookId)) {
      pushToast('这轮任务没找到属于这本书的产出。', 'info')
      return
    }
    const text = assistantTextAfter(now, found.idx)
    if (!text) {
      pushToast('这轮没有产出。', 'info')
      return
    }
    applyTaskText(task, text)
  }

  useEffect(() => {
    if (generating) return
    const task = pendingTaskRef.current
    if (!task) return
    pendingTaskRef.current = null
    reconciledRef.current = true
    applyTaskOutput(task)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating])

  // ── 挂载恢复：切走再回来，把已完成但没落地的产出补上（幂等） ──
  useEffect(() => {
    if (!loaded || !book || generating) return
    if (pendingTaskRef.current) return
    if (reconciledRef.current) return
    const now = (tabId ? getTabState(tabId)?.messages : null) ?? $messages.get()
    const found = lastTaskUser(now)
    if (!found) return
    if (!taskBelongsToBook(found, book.id)) return
    if (
      found.kind !== 'write-chapter' &&
      found.kind !== 'finish-chapter' &&
      found.kind !== 'fill-review'
    )
      return
    if (!book.chapters.some((c) => c.id === found.ref)) return
    if (
      (found.kind === 'write-chapter' || found.kind === 'finish-chapter') &&
      book.drafts.some((d) => d.chapterId === found.ref)
    ) {
      return
    }
    if (found.kind === 'fill-review' && book.reviews.some((r) => r.chapterId === found.ref)) {
      return
    }
    const text = assistantTextAfter(now, found.idx)
    if (!text) return
    reconciledRef.current = true
    applyTaskText(
      found.kind === 'write-chapter'
        ? { kind: 'write-chapter', chapterId: found.ref, bookId: book.id }
        : found.kind === 'finish-chapter'
          ? { kind: 'finish-chapter', chapterId: found.ref, bookId: book.id }
          : { kind: 'fill-review', chapterId: found.ref, bookId: book.id },
      text,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, book, generating])

  // ── 下令：真实调用引擎 ──
  const runTask = async (task: DeskTask, system: string, user: string) => {
    if (!tabId) return
    if (generating) {
      pushToast('上一轮还在生成，先等它完。', 'info')
      return
    }
    const current = books.find((b) => b.id === task.bookId)
    if (!current) {
      pushToast('这本书不在书库里。', 'error')
      return
    }
    const fresh = needsFreshSession(task.kind)
    const ready = await ensureBookSession(current, fresh)
    if (!ready) return
    const st = getTabState(tabId)
    if (!sessionReady({ sessionId: st?.sessionId, phase: 'ready' })) {
      pushToast('写台会话还没就绪，稍等。', 'info')
      return
    }
    const ref =
      task.kind === 'fill-card'
        ? task.target
        : task.kind === 'rewrite' || task.kind === 'wash'
          ? task.beatId
          : task.chapterId
    pendingTaskRef.current = task
    try {
      const ok = await sendSessionPrompt({
        text: taskWire(task.kind, ref, system, user, task.bookId),
        tabId,
      })
      if (!ok) {
        pendingTaskRef.current = null
        pushToast('下达失败：会话未就绪。', 'error')
      }
    } catch (e) {
      pendingTaskRef.current = null
      pushToast(`下达失败：${String(e)}`, 'error')
    }
  }

  const isolateSwitch = () => {
    flushBookNow(openIdRef.current)
    pendingTaskRef.current = null
    reconciledRef.current = false
    if (tabId && generating) void cancelActiveTurn(tabId)
    if (tabId) {
      patchTab(tabId, {
        messages: [],
        permission: null,
        userQuestion: null,
        mcpElicit: null,
      })
    }
  }

  if (!loaded) {
    return (
      <div className="wd-desk wd-desk--loading" role="status">
        加载书库…
      </div>
    )
  }
  if (!book) {
    if (openId) {
      return (
        <div className="wd-desk wd-desk--loading" role="status">
          打开这本书…
        </div>
      )
    }
    return (
      <div className="wd-desk wd-desk--empty" role="status">
        <p className="wd-kicker">写完</p>
        <h1>从左边打开一本书</h1>
        <p>入口是书库。点 + 只问书名、平台、一句话。打开一本才进写台。不是聊天框。</p>
      </div>
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
      patch={patch}
      busy={generating}
      runTask={runTask}
      saveState={saveState}
      onClose={() => {
        isolateSwitch()
        $writingOpenId.set(null)
        rememberLastBook(null)
      }}
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
  patch,
  busy,
  runTask,
  saveState,
  onClose,
}: {
  book: BookDemo
  node: DeskNodeId
  setNode: (id: DeskNodeId) => void
  selectedBeatId?: string
  setSelectedBeatId: (id: string | undefined) => void
  askReply: string | null
  setAskReply: (s: string | null) => void
  patch: PatchBook
  busy: boolean
  runTask: (task: DeskTask, system: string, user: string) => Promise<void>
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  onClose: () => void
}) {
  const parsed = parseNode(node)
  const mode = modeOf(parsed)
  const chapterId = workChapterId(
    parsed,
    book.chapters.filter((c) => !c.locked).at(-1)?.id || book.chapters.at(-1)?.id || '',
  )
  const fillScope: FillScope = {
    chapterId:
      parsed.kind === 'chapter'
        ? parsed.id
        : parsed.kind === 'beats' || parsed.kind === 'draft' || parsed.kind === 'review'
          ? parsed.chapterId
          : chapterId || undefined,
    volumeId: parsed.kind === 'volume' ? parsed.id : undefined,
    unitId: parsed.kind === 'unit' ? parsed.id : undefined,
  }
  const gates = useMemo(() => gatesForNode(book, node), [book, node])
  const dossier = useMemo(() => bookDossier(book), [book])
  const slice = useMemo(() => writeSlice(book, chapterId), [book, chapterId])
  const showSlice = parsed.kind === 'chapter' || parsed.kind === 'beats' || parsed.kind === 'draft'
  const verbs = useMemo(() => verbsForStation(book, node, selectedBeatId), [book, node, selectedBeatId])
  const reviewGate = useMemo(
    () => (chapterId ? reviewBlocksAdopt(book, chapterId) : { ok: true, hints: [] as string[] }),
    [book, chapterId],
  )
  const styleNotes = useMemo(() => (chapterId ? styleHits(book, chapterId) : []), [book, chapterId])
  const written = book.drafts.filter((d) => d.accepted).length
  const wordsAim = parseChapterWords(book.canon.chapterWords)
  const aim = chapterCountFor(undefined, wordsAim.aim)
  const chars = acceptedChars(book)
  const remain = remainToTarget(book)
  const volLine = volumeLandLine(book)
  const beats = chapterId ? book.beatsByChapter[chapterId] || [] : []
  const pct = Math.min(100, Math.round((chars / 1_000_000) * 1000) / 10)
  const draftChars = chapterId
    ? countHanzi(
        (book.drafts.find((d) => d.chapterId === chapterId)?.beats ?? []).map((b) => b.body).join(''),
      )
    : 0
  const wordStat = chapterId ? `已写 ${draftChars} / 目标 ${wordsAim.aim}` : undefined
  const candidates = book.drafts
    .filter((d) => !d.accepted)
    .map((d) => {
      const ch = book.chapters.find((c) => c.id === d.chapterId)
      return { chapterId: d.chapterId, label: `第${ch?.no ?? '?'}章 ${ch?.title || '未拟题'}` }
    })

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

  const runFillCard = (target: FillCardTarget, extra: string, scope: FillScope = fillScope) => {
    const { book: next, card } = fillTargetOf(book, target, scope)
    if (next !== book) patch(() => next)
    void runTask(
      {
        kind: 'fill-card',
        target,
        chapterId: asFillScope(scope).chapterId,
        scope,
        bookId: book.id,
      },
      splitterSystem(FILL_TARGET_LABEL[target]),
      fillCardUser(next !== book ? next : book, target, card, extra),
    )
  }

  const onDispatch = (verb: StationVerb, extra: string) => {
    if (verb.id === 'ask') {
      setAskReply(answerAsk(book, extra))
      return
    }
    if (!verb.ok) {
      pushToast(verb.hint, 'info')
      return
    }
    switch (verb.id) {
      case 'write-chapter': {
        const wire = assembleWriteChapter(book, chapterId, extra)
        if (!wire) {
          pushToast('这一章还不能写（门槛未过）。', 'info')
          return
        }
        void runTask({ kind: 'write-chapter', chapterId, bookId: book.id }, wire.system, wire.user)
        return
      }
      case 'finish-chapter': {
        const wire = assembleWriteChapter(book, chapterId, extra)
        if (!wire) {
          pushToast('这一章还不能写（门槛未过）。', 'info')
          return
        }
        void runTask({ kind: 'finish-chapter', chapterId, bookId: book.id }, wire.system, wire.user)
        return
      }
      case 'fill-review': {
        const user = reviewerUser(book, chapterId, extra)
        if (!user) {
          pushToast('还没有正文可检查。', 'info')
          return
        }
        const jsonUser = `${user}\n\n${reviewerJsonHint()}`
        void runTask({ kind: 'fill-review', chapterId, bookId: book.id }, reviewerSystem(), jsonUser)
        return
      }
      case 'rewrite-span': {
        const target = beats.find((b) => b.id === selectedBeatId)
        if (!target) {
          pushToast('先在稿纸上点一块。', 'info')
          return
        }
        void runTask(
          { kind: 'rewrite', chapterId, beatId: target.id, bookId: book.id },
          writerSystem(),
          rewriteUser(book, chapterId, target, extra),
        )
        return
      }
      case 'wash-span': {
        const gate = washSpanGate(book, chapterId, selectedBeatId)
        if (!gate.ok) {
          pushToast(gate.hint, 'info')
          return
        }
        const target = beats.find((b) => b.id === selectedBeatId)
        if (!target) {
          pushToast('先在稿纸上点一块。', 'info')
          return
        }
        const user = washUser(book, chapterId, target, extra)
        if (!user) {
          pushToast('还没有试笔稿纸。', 'info')
          return
        }
        void runTask(
          { kind: 'wash', chapterId, beatId: target.id, bookId: book.id },
          washerSystem(),
          user,
        )
        return
      }
      case 'adopt-ledger': {
        const blocks = reviewBlocksAdopt(book, chapterId)
        if (!blocks.ok) {
          pushToast(blocks.hints.join('；'), 'info')
          return
        }
        patch((b) => adoptIntoDossier(b, chapterId))
        pushToast('已入卷：人物当前态与伏线已更新，下一章解锁。', 'success')
        const cur = book.chapters.find((c) => c.id === chapterId)
        const next = book.chapters.find((c) => c.no === (cur?.no ?? 0) + 1)
        setNode(next ? next.id : `${chapterId}:review`)
        return
      }
      case 'split-next': {
        const review = book.reviews.find((r) => r.chapterId === chapterId)
        if (!(review?.summary80 || '').trim()) {
          pushToast('入卷需要 80 字摘要。', 'info')
          return
        }
        const no = Math.max(0, ...book.chapters.map((c) => c.no)) + 1
        patch((b) => addChapter(b).book)
        setNode(`ch-${no}`)
        pushToast(`第${no}章纲已建。可点「写章纲」让 AI 拆。`, 'success')
        return
      }
      case 'export-chapter': {
        const ch = book.chapters.find((c) => c.id === chapterId)
        if (!isTauriRuntime()) {
          pushToast('导出只在桌面端可用。', 'info')
          return
        }
        void writingExportBook(book.id, { chapterNo: ch?.no })
          .then((path) => pushToast(`已导出 ${path}`, 'success'))
          .catch((err) => pushToast(String(err), 'error'))
        return
      }
      case 'export-volume': {
        if (parsed.kind !== 'volume') return
        if (!isTauriRuntime()) {
          pushToast('导出只在桌面端可用。', 'info')
          return
        }
        void writingExportBook(book.id, { volumeId: parsed.id })
          .then((path) => pushToast(`已导出 ${path}`, 'success'))
          .catch((err) => pushToast(String(err), 'error'))
        return
      }
      case 'fill-pitch':
        return void runFillCard('pitch', extra)
      case 'write-canon':
        return void runFillCard('canon', extra)
      case 'fill-lead':
        return void runFillCard('lead', extra)
      case 'split-outline':
        return void runFillCard('outline', extra)
      case 'split-volume':
        return void runFillCard('volume', extra)
      case 'split-unit':
        return void runFillCard('unit', extra)
      case 'split-chapter':
        return void runFillCard('chapter', extra)
      case 'split-beats':
        return void runFillCard('beats', extra, { chapterId })
      default:
        pushToast(`「${verb.label}」暂未接引擎，稍后再来。`, 'info')
    }
  }

  return (
    <DeskEdit
      patch={patch}
      onAiFill={(label) => {
        const fill = verbs.find((v) =>
          [
            'fill-pitch',
            'write-canon',
            'fill-lead',
            'split-outline',
            'split-volume',
            'split-unit',
            'split-chapter',
            'split-beats',
          ].includes(v.id),
        )
        if (!fill || !fill.ok) {
          pushToast(fill?.hint || `先点右侧动词补「${label}」。`, 'info')
          return
        }
        onDispatch(fill, `请重点补全字段：${label}`)
      }}
    >
      <div className="wd-desk" role="main" aria-label="写台" data-layout="v2">
        <header className="wd-head">
          <button type="button" className="wd-btn wd-btn-ghost wd-back" onClick={onClose}>
            ← 书
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
              <span className="wd-dk">已入卷 · 章</span>
            </div>
            <div className="wd-ditem">
              <span className="wd-dn">{chars.toLocaleString('zh-CN')}</span>
              <span className="wd-dk">字 · 还差 {remain.toLocaleString('zh-CN')}{volLine ? ` · ${volLine}` : ''}</span>
            </div>
            <div className="wd-dbar" aria-label={`进度 ${pct}%`}>
              <div className="wd-dbar-in" style={{ width: `${pct}%` }} />
            </div>
            <div className="wd-ditem">
              <span className="wd-save">
                {saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : '已保存'}
              </span>
              <span className="wd-dk">本地 · 每书一档</span>
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
                onAdopt={() => {
                  patch((b) => ({
                    ...b,
                    drafts: b.drafts.map((d) =>
                      d.chapterId === chapterId ? { ...d, accepted: true } : d,
                    ),
                  }))
                  pushToast('已进正史。下一步检查这一章。', 'success')
                  setNode(`${chapterId}:review`)
                }}
                onDiscard={() => {
                  patch((b) => ({
                    ...b,
                    drafts: b.drafts.filter((d) => d.chapterId !== chapterId),
                  }))
                  pushToast('已丢掉这版试笔，可重新下令。', 'info')
                }}
                onRevert={() => {
                  patch((b) => ({
                    ...b,
                    drafts: b.drafts.map((d) =>
                      d.chapterId === chapterId ? { ...d, accepted: false } : d,
                    ),
                  }))
                  pushToast('已退回试笔，可以重写。正史标记已去掉。', 'info')
                }}
                onAddPerson={() => goAdd(addPerson, personNode)}
                onAddRule={() => goAdd(addRule, ruleNode)}
                onAddPlace={() => goAdd(addPlace, placeNode)}
                onAddBeat={(id) => goAdd((b) => addBeat(b, id), () => beatsNode(id))}
                onAddForeshadow={() => goAdd(addForeshadow, () => 'outline')}
                reviewBlocks={reviewGate.ok ? [] : reviewGate.hints}
                styleNotes={styleNotes}
                onRegisterUnnumbered={() => {
                  patch((b) => registerForeshadowsFromReview(b, chapterId))
                  pushToast('未编号已写进伏笔表。', 'success')
                }}
              />
            </div>
            <div className="wd-dock">
              <CommandDock
                verbs={verbs}
                fallback={defaultVerb(book, node)}
                askReply={askReply}
                onClearAsk={() => setAskReply(null)}
                onDispatch={onDispatch}
                busy={busy}
                stat={wordStat}
              />
            </div>
          </div>
          <aside className="wd-rail" aria-label="试笔与案卷">
            <CandidatePanel candidates={candidates} onOpen={setNode} />
            <DossierRail dossier={dossier} onOpen={setNode} />
          </aside>
        </div>
      </div>
    </DeskEdit>
  )
}
