/**
 * 写完书库：侧栏和写台共用。不是引擎会话列表。
 */
import { atom } from 'nanostores'
import { isTauriRuntime } from '../bridge'
import { emptyBook } from './model/empty-book'
import { gapLabel } from './framework/station'
import { chapterCountFor } from './framework/scale'
import type { BookDemo } from './model/types'
import { loadAllBooks, persistBook, writingDeleteBook } from './storage'

export const LAST_BOOK_KEY = 'vesprism.writing.lastBook'
export const WRITING_CHAPTER_AIM = chapterCountFor()

export const $writingBooks = atom<BookDemo[]>([])
export const $writingOpenId = atom<string | null>(null)
export const $writingLastId = atom<string | null>(null)
export const $writingLoaded = atom(false)

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
  $writingBooks.set(fn($writingBooks.get()))
}

export function bookProgress(book: BookDemo): { done: number; aim: number; pct: number } {
  const done = book.drafts.filter((d) => d.accepted).length
  const aim = WRITING_CHAPTER_AIM
  const pct = aim > 0 ? Math.min(100, Math.round((done / aim) * 1000) / 10) : 0
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
    let list: BookDemo[] = []
    try {
      list = await loadAllBooks()
    } catch (e) {
      console.warn('[writing] 书库加载失败:', e)
    }
    $writingBooks.set(list)
    $writingLoaded.set(true)
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_BOOK_KEY)
    } catch {
      last = null
    }
    const remembered = last ? list.find((b) => b.id === last) : undefined
    const target = remembered ?? list[0]
    // 记住上一本，但不自动摊开。切写完 / ← 书 都停在书库，人从左边点开。
    if (target) $writingLastId.set(target.id)
  })()
  return bootOnce
}

export function createWritingBook(init: { title: string; platform: string; logline: string }): BookDemo {
  const next = emptyBook(init)
  mapWritingBooks((prev) => [...prev, next])
  $writingOpenId.set(next.id)
  $writingLastId.set(next.id)
  rememberLastBook(next.id)
  if (isTauriRuntime()) {
    void persistBook(next).catch((e) => console.warn('[writing] 新建保存失败:', e))
  }
  return next
}

export function deleteWritingBook(id: string): void {
  mapWritingBooks((prev) => prev.filter((b) => b.id !== id))
  if ($writingOpenId.get() === id) $writingOpenId.set(null)
  if ($writingLastId.get() === id) $writingLastId.set(null)
  rememberLastBook($writingOpenId.get())
  if (isTauriRuntime()) {
    void writingDeleteBook(id).catch((e) => console.warn('[writing] 删除失败:', e))
  }
}

export function selectWritingBook(id: string): void {
  const hit = $writingBooks.get().find((b) => b.id === id)
  if (!hit) return
  $writingOpenId.set(id)
  $writingLastId.set(id)
  rememberLastBook(id)
}

/** 测试用 */
export function resetWritingLibraryForTests() {
  bootOnce = null
  $writingBooks.set([])
  $writingOpenId.set(null)
  $writingLastId.set(null)
  $writingLoaded.set(false)
}
