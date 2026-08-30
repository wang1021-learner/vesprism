import { describe, expect, it } from 'vitest'
import { chapterCountFor, contextBudget, NOVEL_SCALE, volumeChapterAim } from './scale'

describe('百万字规模', () => {
  it('按 2200 字一章，100 万字约 455 章', () => {
    expect(chapterCountFor()).toBe(455)
    expect(volumeChapterAim()).toBe(114)
    expect(NOVEL_SCALE.targetChars).toBe(1_000_000)
  })

  it('写手不吃全书，记忆在案卷', () => {
    const b = contextBudget()
    expect(b.writerEats).toMatch(/切片/)
    expect(b.writerNever).toMatch(/总纲全文/)
    expect(b.memory).toMatch(/入卷采纳/)
  })
})
