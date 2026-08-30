import { describe, expect, it } from 'vitest'
import { addBeat, addChapter, addForeshadow, addPerson, addPlace, addRule, addVolume, splitList, splitSlash } from './create'
import { emptyBook } from './empty-book'

describe('写台当场新建', () => {
  it('空书可以新建主角卡和章', () => {
    const book = emptyBook({ title: '试', platform: '番茄', logline: '一句话' })
    const person = addPerson(book)
    expect(person.book.people[0]?.role).toBe('主角')
    const vol = addVolume(person.book)
    const ch = addChapter(vol.book)
    expect(ch.book.chapters[0]?.id).toBe('ch-1')
    expect(ch.book.units.length).toBeGreaterThan(0)
    const beat = addBeat(ch.book, ch.id)
    expect(beat.book.beatsByChapter[ch.id]?.length).toBe(1)
    expect(ch.book.chapters[0]?.locked).not.toBe(true)
  })

  it('上一章没入卷，新开的章默认上锁', () => {
    const book = emptyBook({ title: '试', platform: '番茄', logline: '一句话' })
    const first = addChapter(book)
    expect(first.book.chapters[0]?.locked).toBeFalsy()
    const second = addChapter(first.book)
    expect(second.book.chapters[1]?.locked).toBe(true)
    expect(second.book.chapters[1]?.lockReason).toMatch(/入卷/)
  })

  it('斜杠和分号拆列表', () => {
    expect(splitSlash('赝品眼 / 第二名')).toEqual(['赝品眼', '第二名'])
    expect(splitList('打脸；反杀')).toEqual(['打脸', '反杀'])
  })

  it('规则地点伏笔可追加', () => {
    const book = emptyBook()
    const rule = addRule(book)
    expect(rule.book.rules).toHaveLength(1)
    expect(rule.book.rules[0]?.quotaLeft).toBe('')
    expect(rule.book.rules[0]?.quotaAsOfChapter).toBe(0)
    expect(addPlace(book).book.places).toHaveLength(1)
    expect(addForeshadow(book).id).toBe('F001')
  })
})
