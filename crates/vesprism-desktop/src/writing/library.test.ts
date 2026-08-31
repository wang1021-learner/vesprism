import { describe, expect, it, beforeEach } from 'vitest'
import { emptyBook } from './model/empty-book'
import {
  bookLandLine,
  bookProgress,
  bookStatus,
  createWritingBook,
  resetWritingLibraryForTests,
  shelfFromBook,
  $writingBooks,
  $writingOpenId,
  $writingShelf,
} from './library'

describe('写完书库', () => {
  beforeEach(() => {
    resetWritingLibraryForTests()
  })

  it('空书停在开卷，进度为 0', () => {
    const book = emptyBook({ title: '试', platform: '番茄', logline: '一句' })
    expect(bookLandLine(book)).toBe('开卷')
    expect(bookStatus(book).label).toBe('连载中')
    expect(bookProgress(book).done).toBe(0)
  })

  it('新建一本会进书库并设为打开', () => {
    const b = createWritingBook({ title: '赝品眼', platform: '番茄', logline: '学徒开三次瞳' })
    expect($writingBooks.get().some((x) => x.id === b.id)).toBe(true)
    expect($writingShelf.get().some((x) => x.id === b.id && x.title === '赝品眼')).toBe(true)
    expect($writingOpenId.get()).toBe(b.id)
    expect(b.title).toBe('赝品眼')
  })

  it('书架条目只带书名进度，不带章正文', () => {
    const book = emptyBook({ title: '试', platform: '番茄', logline: '一句' })
    const item = shelfFromBook(book)
    expect(item.title).toBe('试')
    expect(item.accepted).toBe(0)
    expect(item.accepted_chars).toBe(0)
    expect(item.land_line).toBe('开卷')
    expect(JSON.stringify(item)).not.toMatch(/beatsByChapter/)
  })
})
