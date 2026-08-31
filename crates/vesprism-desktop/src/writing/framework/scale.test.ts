import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from '../model/demo-yanpin'
import {
  acceptedChars,
  chapterCountFor,
  contextBudget,
  countHanzi,
  NOVEL_SCALE,
  parseChapterWords,
  remainToTarget,
  volumeChapterAim,
  volumeLandLine,
} from './scale'

describe('百万字规模', () => {
  it('按 2200 字一章，100 万字约 455 章', () => {
    expect(chapterCountFor()).toBe(455)
    expect(volumeChapterAim()).toBe(114)
    expect(NOVEL_SCALE.targetChars).toBe(1_000_000)
  })

  it('尺规字符串解析成区间，不锁死 2200', () => {
    expect(parseChapterWords('2000～2500')).toEqual({ min: 2000, max: 2500, aim: 2250 })
    expect(parseChapterWords('1500')).toMatchObject({ aim: 1500, min: 1500, max: 1500 })
    expect(parseChapterWords('')).toEqual({
      min: NOVEL_SCALE.chapterMin,
      max: NOVEL_SCALE.chapterMax,
      aim: NOVEL_SCALE.chapterAim,
    })
  })

  it('数汉字，空白和英文不计', () => {
    expect(countHanzi('他推开门。abc  ')).toBe(4)
    expect(countHanzi('')).toBe(0)
  })

  it('已入卷字数和距百万、本卷写到哪', () => {
    const n = acceptedChars(YANPIN_EYE)
    expect(n).toBeGreaterThan(0)
    expect(remainToTarget(YANPIN_EYE)).toBe(NOVEL_SCALE.targetChars - n)
    expect(volumeLandLine(YANPIN_EYE)).toMatch(/卷一|卷1|第3章/)
  })

  it('写手不吃全书，记忆在案卷', () => {
    const b = contextBudget()
    expect(b.writerEats).toMatch(/切片/)
    expect(b.writerNever).toMatch(/总纲全文/)
    expect(b.memory).toMatch(/入卷采纳/)
  })
})
