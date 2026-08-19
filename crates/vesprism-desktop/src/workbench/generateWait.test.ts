import { describe, expect, it } from 'vitest'
import {
  consumeCanvasGraph,
  expectCanvasGraph,
  isCanvasHeal,
  isPendingCanvasGraph,
  markCanvasHeal,
  noteGenerateProgress,
  type GenerateWait,
} from './generateWait'

describe('noteGenerateProgress', () => {
  it('generating 尚未亮起时不收结果', () => {
    const wait: GenerateWait = { tabId: 't', before: 0, promptId: 'p', started: false }
    expect(noteGenerateProgress(wait, true, false)).toBe('ignore')
  })

  it('generating 亮起后记 started，灭掉才 finish', () => {
    const wait: GenerateWait = { tabId: 't', before: 0, promptId: 'p', started: false }
    expect(noteGenerateProgress(wait, true, true)).toBe('started')
    wait.started = true
    expect(noteGenerateProgress(wait, true, true)).toBe('started')
    expect(noteGenerateProgress(wait, true, false)).toBe('finish')
  })
})

describe('expectCanvasGraph', () => {
  it('只有登记过的 prompt 才能消费', () => {
    expect(isPendingCanvasGraph('p-new')).toBe(false)
    expectCanvasGraph('p-new')
    expect(isPendingCanvasGraph('p-new')).toBe(true)
    expect(consumeCanvasGraph('p-new')).toBe(true)
    expect(isPendingCanvasGraph('p-new')).toBe(false)
    expect(consumeCanvasGraph('p-new')).toBe(false)
  })
})

describe('canvas heal', () => {
  it('登记过的自愈回合可识别', () => {
    expect(isCanvasHeal('p-heal')).toBe(false)
    markCanvasHeal('p-heal')
    expect(isCanvasHeal('p-heal')).toBe(true)
  })
})
