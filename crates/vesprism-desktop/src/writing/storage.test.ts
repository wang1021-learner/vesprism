import { describe, expect, it } from 'vitest'
import { emptyBook } from './model/empty-book'
import { isLoadableBook } from './storage'

describe('书库加载校验', () => {
  it('完整空书可以通过', () => {
    expect(isLoadableBook(emptyBook({ title: '试', platform: '番茄', logline: '一句' }))).toBe(true)
  })

  it('只有 id/title、缺 pitch 的坏文件不能进书库', () => {
    expect(isLoadableBook({ id: 'book-1', title: '残' })).toBe(false)
    expect(isLoadableBook({ id: 'book-1', title: '残', pitch: { titles: '字符串' } })).toBe(false)
  })
})
