/**
 * 写台书持久化：走 Rust `writing_store`
 * （~/.vesprism/books/<id>/meta.json + book.json + chapters/NNNN.json）。
 * 书库从用户新建开始；无种子、无演示数据。
 */
import { invoke } from '@tauri-apps/api/core'
import type { BookDemo } from './model/types'

export type WritingBookMeta = {
  id: string
  title: string
  updated_at: string
  accepted?: number
  has_candidate?: boolean
  land_line?: string
}

export const writingListBooks = () => invoke<WritingBookMeta[]>('writing_list_books')
export const writingLoadBook = (id: string) => invoke<string>('writing_load_book', { id })
export const writingSaveBook = (id: string, json: string) =>
  invoke<void>('writing_save_book', { id, json })
export const writingDeleteBook = (id: string) =>
  invoke<void>('writing_delete_book', { id })
export const writingSessionCwd = (id: string) =>
  invoke<string>('writing_session_cwd', { id })
export const writingExportBook = (id: string, chapterNo?: number | null) =>
  invoke<string>('writing_export_book', { id, chapter_no: chapterNo ?? null })

/** 坏文件不能进书库：缺 pitch 会在渲染时把写台打崩。 */
export function isLoadableBook(raw: unknown): raw is BookDemo {
  if (!raw || typeof raw !== 'object') return false
  const b = raw as BookDemo
  if (typeof b.id !== 'string' || typeof b.title !== 'string') return false
  if (!b.pitch || typeof b.pitch !== 'object' || !Array.isArray(b.pitch.titles) || !Array.isArray(b.pitch.hooks)) {
    return false
  }
  if (!b.pitch.firstThree || typeof b.pitch.firstThree !== 'object') return false
  if (!b.canon || typeof b.canon !== 'object') return false
  if (!Array.isArray(b.people) || !Array.isArray(b.chapters) || !Array.isArray(b.drafts)) return false
  return true
}

export async function loadAllBooks(): Promise<BookDemo[]> {
  const metas = await writingListBooks()
  const out: BookDemo[] = []
  for (const m of metas) {
    try {
      const raw = await writingLoadBook(m.id)
      const book = JSON.parse(raw) as unknown
      if (isLoadableBook(book)) {
        if (book.id !== m.id) {
          console.warn('[writing] 跳过 id 与文件名不一致的书:', m.id, book.id)
          continue
        }
        out.push(book)
      } else {
        console.warn('[writing] 跳过结构不完整的书:', m.id)
      }
    } catch (e) {
      console.warn('[writing] 跳过损坏的书:', m.id, e)
    }
  }
  return out
}

/** 保存一本（更新 updatedAt 时间戳）。调用方可 debounce。 */
export function persistBook(book: BookDemo): Promise<void> {
  const stamped = { ...book, updatedAt: new Date().toISOString() }
  return writingSaveBook(book.id, JSON.stringify(stamped))
}
