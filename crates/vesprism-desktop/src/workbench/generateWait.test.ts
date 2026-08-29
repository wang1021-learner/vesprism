import { describe, expect, it, beforeEach } from 'vitest'
import {
  consumeCanvasGraph,
  expectCanvasGraph,
  inheritCanvasPromptId,
  isCanvasHeal,
  isPendingCanvasGraph,
  latestExpectedCanvasGraph,
  markCanvasHeal,
  noteGenerateProgress,
  resetCanvasGraphWait,
  resetCanvasGraphWaitForTests,
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
  beforeEach(() => {
    resetCanvasGraphWaitForTests()
  })

  it('只有登记过的 prompt 才能消费', () => {
    expect(isPendingCanvasGraph('p-new')).toBe(false)
    expectCanvasGraph('p-new')
    expect(isPendingCanvasGraph('p-new')).toBe(true)
    expect(consumeCanvasGraph('p-new')).toBe(true)
    expect(isPendingCanvasGraph('p-new')).toBe(false)
    expect(consumeCanvasGraph('p-new')).toBe(false)
  })

  it('按 Tab 分片：A 的 expect 不影响 B，清 A 不清 B', () => {
    expectCanvasGraph('p-a', 'tab-a')
    expectCanvasGraph('p-b', 'tab-b')
    expect(isPendingCanvasGraph('p-a', 'tab-a')).toBe(true)
    expect(isPendingCanvasGraph('p-a', 'tab-b')).toBe(false)
    expect(isPendingCanvasGraph('p-b', 'tab-b')).toBe(true)
    resetCanvasGraphWait('tab-a')
    expect(isPendingCanvasGraph('p-a', 'tab-a')).toBe(false)
    expect(isPendingCanvasGraph('p-b', 'tab-b')).toBe(true)
    expect(latestExpectedCanvasGraph('tab-b')).toBe('p-b')
  })

  it('inherit 只认本 Tab 的 pending，不把画布 pid 盖到别的会话', () => {
    expectCanvasGraph('p-canvas', 'tab-flow')
    expect(inheritCanvasPromptId('p-chat', 'tab-chat')).toBe('p-chat')
    expect(inheritCanvasPromptId(undefined, 'tab-chat')).toBeUndefined()
    expect(inheritCanvasPromptId(undefined, 'tab-flow')).toBe('p-canvas')
    expect(inheritCanvasPromptId('p-other', 'tab-flow')).toBe('p-canvas')
  })
})

describe('canvas heal', () => {
  beforeEach(() => {
    resetCanvasGraphWaitForTests()
  })

  it('登记过的自愈回合可识别', () => {
    expect(isCanvasHeal('p-heal')).toBe(false)
    markCanvasHeal('p-heal')
    expect(isCanvasHeal('p-heal')).toBe(true)
  })

  it('自愈标记按 Tab 隔离', () => {
    markCanvasHeal('p-heal', 'tab-a')
    expect(isCanvasHeal('p-heal', 'tab-a')).toBe(true)
    expect(isCanvasHeal('p-heal', 'tab-b')).toBe(false)
  })
})
