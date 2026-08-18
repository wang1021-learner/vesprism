import { describe, expect, it } from 'vitest'
import { noteGenerateProgress, type GenerateWait } from './generateWait'

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
