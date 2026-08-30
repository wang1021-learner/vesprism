import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { SLICE_FORBIDDEN, writeSlice } from './slice'

describe('写本章切片', () => {
  it('第4章只带尺规切片、出场当前态、到期伏笔、节拍', () => {
    const s = writeSlice(YANPIN_EYE, 'ch-4')
    expect(s).toBeTruthy()
    if (!s) return
    expect(s.canon.pov).toBe('限知沈见真')
    expect(s.people.map((p) => p.id).sort()).toEqual(['gu', 'shen'])
    expect(s.places.map((p) => p.id)).toEqual(['vault'])
    expect(s.rules.map((r) => r.id)).toEqual(['eye'])
    expect(s.due.map((f) => f.id).sort()).toEqual(['F001', 'F003'])
    expect(s.beats).toHaveLength(3)
    expect(s.locked).toBe(false)
  })

  it('切片不夹带总纲全文', () => {
    const s = writeSlice(YANPIN_EYE, 'ch-4')
    const blob = JSON.stringify(s)
    expect(blob.includes(YANPIN_EYE.outline.causality)).toBe(false)
    expect(blob.includes(YANPIN_EYE.outline.act1)).toBe(false)
    for (const key of SLICE_FORBIDDEN) {
      expect(blob.includes(`"${key}"`)).toBe(false)
    }
  })

  it('第5章切片为空出场且上锁；未到期伏笔不进切片', () => {
    const s = writeSlice(YANPIN_EYE, 'ch-5')
    expect(s?.locked).toBe(true)
    expect(s?.people).toEqual([])
    expect(s?.beats).toEqual([])
    expect(s?.due).toEqual([])
    const ch4 = writeSlice(YANPIN_EYE, 'ch-4')
    expect(ch4?.due.some((f) => f.id === 'F002')).toBe(false)
    expect(ch4?.due.some((f) => f.id === 'F004')).toBe(false)
  })
})
