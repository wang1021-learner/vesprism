import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from '../model/demo-yanpin'
import { emptyBook } from '../model/empty-book'
import {
  defaultVerb,
  entryReady,
  landNode,
  pitchReady,
  verbsForStation,
  writeChapterGate,
} from './station'

describe('工位', () => {
  it('演示书三问已齐，打开停在第4章候选', () => {
    expect(entryReady(YANPIN_EYE)).toBe(true)
    expect(landNode(YANPIN_EYE)).toBe('ch-4:draft')
  })

  it('空书没有三问，不准写本章', () => {
    const book = emptyBook()
    expect(entryReady(book)).toBe(false)
    expect(pitchReady(book)).toBe(false)
    expect(landNode(book)).toBe('pitch')
    expect(writeChapterGate(book, 'ch-4').ok).toBe(false)
    expect(defaultVerb(book, 'pitch').id).toBe('fill-pitch')
  })

  it('只有三问时仍是补立项，写本章仍锁', () => {
    const book = emptyBook({ title: '赝品眼', platform: '番茄 / 男频', logline: '学徒开三次瞳' })
    expect(entryReady(book)).toBe(true)
    expect(pitchReady(book)).toBe(false)
    expect(defaultVerb(book, 'pitch').id).toBe('fill-pitch')
    expect(writeChapterGate(book, 'ch-1').ok).toBe(false)
  })

  it('第4章工位不含拆宪法 / 开新书，含写本章', () => {
    const verbs = verbsForStation(YANPIN_EYE, 'ch-4')
    const ids = verbs.map((v) => v.id)
    expect(ids).toContain('write-chapter')
    expect(ids).toContain('split-beats')
    expect(ids).toContain('ask')
    expect(ids).not.toContain('fill-pitch')
    expect(ids).not.toContain('write-canon')
    expect(ids).not.toContain('start-book')
    expect(verbs.find((v) => v.id === 'write-chapter')?.ok).toBe(true)
    expect(defaultVerb(YANPIN_EYE, 'ch-4').id).toBe('write-chapter')
    expect(defaultVerb(YANPIN_EYE, 'ch-4:draft').id).toBe('fill-review')
  })

  it('第5章写本章锁；问永远可点', () => {
    const verbs = verbsForStation(YANPIN_EYE, 'ch-5')
    expect(verbs.find((v) => v.id === 'write-chapter')?.ok).toBe(false)
    expect(verbs.find((v) => v.id === 'ask')?.ok).toBe(true)
  })
})
