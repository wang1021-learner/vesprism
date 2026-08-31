import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from '../model/demo-yanpin'
import { emptyBook } from '../model/empty-book'
import {
  defaultVerb,
  entryReady,
  landNode,
  pitchReady,
  verbsForStation,
  washSpanGate,
  writeChapterGate,
} from './station'

describe('案头', () => {
  it('演示书三问已齐，打开停在第4章试笔', () => {
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

  it('只有三问时仍是补开卷，写本章仍锁', () => {
    const book = emptyBook({ title: '赝品眼', platform: '番茄 / 男频', logline: '学徒开三次瞳' })
    expect(entryReady(book)).toBe(true)
    expect(pitchReady(book)).toBe(false)
    expect(defaultVerb(book, 'pitch').id).toBe('fill-pitch')
    expect(writeChapterGate(book, 'ch-1').ok).toBe(false)
  })

  it('第4章案头不含起草规矩 / 开新书，含写本章', () => {
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

  it('已进正史不准再点写本章；没进正史不准入卷', () => {
    expect(writeChapterGate(YANPIN_EYE, 'ch-4').ok).toBe(true)
    const accepted = {
      ...YANPIN_EYE,
      drafts: YANPIN_EYE.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
    }
    expect(writeChapterGate(accepted, 'ch-4').ok).toBe(false)
    expect(writeChapterGate(accepted, 'ch-4').hint).toMatch(/正史/)
    expect(verbsForStation(YANPIN_EYE, 'ch-4:review').find((v) => v.id === 'adopt-ledger')?.ok).toBe(
      false,
    )
    expect(verbsForStation(accepted, 'ch-4:review').find((v) => v.id === 'adopt-ledger')?.ok).toBe(true)
  })

  it('已入卷但摘要空，不准开下一章', () => {
    const adopted = {
      ...YANPIN_EYE,
      drafts: YANPIN_EYE.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
      reviews: YANPIN_EYE.reviews.map((r) =>
        r.chapterId === 'ch-4' ? { ...r, adopted: true, summary80: '' } : r,
      ),
    }
    const v = verbsForStation(adopted, 'ch-4:review')
    expect(v.find((x) => x.id === 'split-next')?.ok).toBe(false)
    expect(v.find((x) => x.id === 'split-next')?.hint).toMatch(/摘要/)
  })

  it('稿纸默认仍是检查；洗这块是芯片；没点块 / 已正史不可洗', () => {
    const verbs = verbsForStation(YANPIN_EYE, 'ch-4:draft')
    expect(defaultVerb(YANPIN_EYE, 'ch-4:draft').id).toBe('fill-review')
    expect(verbs.map((v) => v.id)).toContain('wash-span')
    expect(verbs.find((v) => v.id === 'wash-span')?.ok).toBe(true)

    const noDraft = { ...YANPIN_EYE, drafts: [] }
    expect(washSpanGate(noDraft, 'ch-4', 'b1').ok).toBe(false)
    expect(washSpanGate(YANPIN_EYE, 'ch-4', undefined).ok).toBe(false)
    expect(washSpanGate(YANPIN_EYE, 'ch-4', undefined).hint).toMatch(/点一块/)

    const accepted = {
      ...YANPIN_EYE,
      drafts: YANPIN_EYE.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
    }
    expect(washSpanGate(accepted, 'ch-4', 'b1').ok).toBe(false)
    expect(washSpanGate(accepted, 'ch-4', 'b1').hint).toMatch(/试笔/)
  })

  it('番茄开场钩空不准写本章、不准切开；起点不卡开场钩', () => {
    const tomato = {
      ...YANPIN_EYE,
      chapters: YANPIN_EYE.chapters.map((c) =>
        c.id === 'ch-4' ? { ...c, platform: 'tomato' as const, openHook: '' } : c,
      ),
    }
    expect(writeChapterGate(tomato, 'ch-4').ok).toBe(false)
    expect(writeChapterGate(tomato, 'ch-4').hint).toMatch(/物理事件/)
    expect(verbsForStation(tomato, 'ch-4').find((v) => v.id === 'split-beats')?.ok).toBe(false)

    const qidian = {
      ...YANPIN_EYE,
      chapters: YANPIN_EYE.chapters.map((c) =>
        c.id === 'ch-4' ? { ...c, platform: 'qidian' as const, openHook: '' } : c,
      ),
    }
    expect(writeChapterGate(qidian, 'ch-4').ok).toBe(true)
  })
})
