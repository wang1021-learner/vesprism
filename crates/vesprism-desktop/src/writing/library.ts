/**
 * 写完书库：侧栏和写台共用。不是引擎会话列表。
 */
import { atom } from 'nanostores'
import { isTauriRuntime } from '../bridge'
import { emptyBook } from './model/empty-book'
import { gapLabel } from './framework/station'
import {
  acceptedChars,
  chapterCountFor,
  NOVEL_SCALE,
  parseChapterWords,
  remainToTarget,
  volumeLandLine,
} from './framework/scale'
import type { BookDemo } from './model/types'
import {
  isLoadableBook,
  persistBook,
  writingDeleteBook,
  writingListBooks,
  writingLoadBook,
  type WritingBookMeta,
} from './storage'

export const LAST_BOOK_KEY = 'vesprism.writing.lastBook'
export const WRITING_CHAPTER_AIM = chapterCountFor()

export type WritingShelfItem = {
  id: string
  title: string
  updated_at: string
  accepted: number
  accepted_chars: number
  target_chars: number
  remain_chars: number
  volume_line: string
  aim: number
  has_candidate: boolean
  land_line: string
}

export const $writingShelf = atom<WritingShelfItem[]>([])
export const $writingBooks = atom<BookDemo[]>([])
export const $writingOpenId = atom<string | null>(null)
export const $writingLastId = atom<string | null>(null)
export const $writingLoaded = atom(false)

export function shelfFromBook(book: BookDemo): WritingShelfItem {
  const prog = bookProgress(book)
  const chars = acceptedChars(book)
  return {
    id: book.id,
    title: book.title,
    updated_at: book.updatedAt ?? '',
    accepted: prog.done,
    accepted_chars: chars,
    target_chars: NOVEL_SCALE.targetChars,
    remain_chars: remainToTarget(book),
    volume_line: volumeLandLine(book),
    aim: prog.aim,
    has_candidate: bookStatus(book).tone === 'is-cand',
    land_line: bookLandLine(book),
  }
}

export function shelfFromMeta(m: WritingBookMeta): WritingShelfItem {
  const accepted_chars = m.accepted_chars ?? 0
  const target_chars = m.target_chars ?? NOVEL_SCALE.targetChars
  return {
    id: m.id,
    title: m.title,
    updated_at: m.updated_at,
    accepted: m.accepted ?? 0,
    accepted_chars,
    target_chars,
    remain_chars: m.remain_chars ?? Math.max(0, target_chars - accepted_chars),
    volume_line: m.volume_line || '',
    aim: m.aim ?? WRITING_CHAPTER_AIM,
    has_candidate: m.has_candidate ?? false,
    land_line: m.land_line || '开卷',
  }
}

function upsertShelf(item: WritingShelfItem) {
  const prev = $writingShelf.get()
  const i = prev.findIndex((x) => x.id === item.id)
  if (i < 0) $writingShelf.set([...prev, item])
  else $writingShelf.set(prev.map((x, idx) => (idx === i ? item : x)))
}

let bootOnce: Promise<void> | null = null

export function rememberLastBook(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_BOOK_KEY, id)
    else localStorage.removeItem(LAST_BOOK_KEY)
  } catch {
    /* ignore */
  }
}

export function mapWritingBooks(fn: (list: BookDemo[]) => BookDemo[]) {
  const next = fn($writingBooks.get())
  $writingBooks.set(next)
  const byId = new Map(next.map((b) => [b.id, shelfFromBook(b)]))
  $writingShelf.set($writingShelf.get().map((item) => byId.get(item.id) ?? item))
}

export function bookProgress(book: BookDemo): { done: number; aim: number; pct: number } {
  const done = book.drafts.filter((d) => d.accepted).length
  const aim = chapterCountFor(NOVEL_SCALE.targetChars, parseChapterWords(book.canon.chapterWords).aim)
  const chars = acceptedChars(book)
  const pct =
    NOVEL_SCALE.targetChars > 0
      ? Math.min(100, Math.round((chars / NOVEL_SCALE.targetChars) * 1000) / 10)
      : 0
  return { done, aim, pct }
}

export function bookStatus(book: BookDemo): { label: string; tone: 'is-cand' | 'is-ok' } {
  const hasCandidate = book.drafts.some((d) => !d.accepted) || book.reviews.some((r) => !r.adopted)
  return hasCandidate ? { label: '试笔', tone: 'is-cand' } : { label: '连载中', tone: 'is-ok' }
}

export function bookLandLine(book: BookDemo): string {
  const draft = book.drafts.find((d) => !d.accepted)
  if (draft) {
    const ch = book.chapters.find((c) => c.id === draft.chapterId)
    return ch ? `第${ch.no}章试笔` : '试笔'
  }
  const review = book.reviews.find((r) => !r.adopted)
  if (review) {
    const ch = book.chapters.find((c) => c.id === review.chapterId)
    return ch ? `第${ch.no}章检查` : '检查'
  }
  const last = [...book.chapters].reverse().find((c) => !c.locked) ?? book.chapters.at(-1)
  return last ? `第${last.no}章` : '开卷'
}

export function bookSubline(book: BookDemo): string {
  return gapLabel(book)
}

export async function bootWritingLibrary(): Promise<void> {
  if (bootOnce) return bootOnce
  bootOnce = (async () => {
    let shelf: WritingShelfItem[] = []
    try {
      const metas = await writingListBooks()
      shelf = metas.map(shelfFromMeta)
    } catch (e) {
      console.warn('[writing] 书库加载失败:', e)
    }
    $writingShelf.set(shelf)
    $writingLoaded.set(true)
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_BOOK_KEY)
    } catch {
      last = null
    }
    const remembered = last ? shelf.find((b) => b.id === last) : undefined
    const target = remembered ?? shelf[0]
    // 记住上一本，但不自动摊开。切写完 / ← 书 都停在书库，人从左边点开。
    if (target) $writingLastId.set(target.id)
  })()
  return bootOnce
}

export function createWritingBook(init: { title: string; platform: string; logline: string }): BookDemo {
  const next = emptyBook(init)
  upsertShelf(shelfFromBook(next))
  mapWritingBooks((prev) => [...prev.filter((b) => b.id !== next.id), next])
  $writingOpenId.set(next.id)
  $writingLastId.set(next.id)
  rememberLastBook(next.id)
  if (isTauriRuntime()) {
    void persistBook(next).catch((e) => console.warn('[writing] 新建保存失败:', e))
  }
  return next
}

export function deleteWritingBook(id: string): void {
  $writingShelf.set($writingShelf.get().filter((b) => b.id !== id))
  mapWritingBooks((prev) => prev.filter((b) => b.id !== id))
  if ($writingOpenId.get() === id) $writingOpenId.set(null)
  if ($writingLastId.get() === id) $writingLastId.set(null)
  rememberLastBook($writingOpenId.get())
  if (isTauriRuntime()) {
    void writingDeleteBook(id).catch((e) => console.warn('[writing] 删除失败:', e))
  }
}

export async function selectWritingBook(id: string): Promise<void> {
  $writingOpenId.set(id)
  $writingLastId.set(id)
  rememberLastBook(id)
  if ($writingBooks.get().some((b) => b.id === id)) return
  if (!isTauriRuntime()) return
  try {
    const raw = await writingLoadBook(id)
    const book = JSON.parse(raw) as unknown
    if (!isLoadableBook(book) || book.id !== id) {
      console.warn('[writing] 这本书结构不完整:', id)
      if ($writingOpenId.get() === id) $writingOpenId.set(null)
      return
    }
    mapWritingBooks((prev) => [...prev.filter((b) => b.id !== id), book])
    upsertShelf(shelfFromBook(book))
  } catch (e) {
    console.warn('[writing] 打开书失败:', id, e)
    if ($writingOpenId.get() === id) $writingOpenId.set(null)
  }
}

/** 测试用 */
export function resetWritingLibraryForTests() {
  bootOnce = null
  $writingShelf.set([])
  $writingBooks.set([])
  $writingOpenId.set(null)
  $writingLastId.set(null)
  $writingLoaded.set(false)
}
