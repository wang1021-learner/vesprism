import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import {
  beatsNode,
  chapterHasStack,
  jumpMode,
  jumpNode,
  layerOf,
  modeOf,
  parseNode,
  workChapterId,
} from './nodes'

describe('写台节点路由', () => {
  it('解析人物 / 章内子页', () => {
    expect(parseNode('engine')).toEqual({ kind: 'engine' })
    expect(parseNode('person-shen')).toEqual({ kind: 'person', id: 'shen' })
    expect(parseNode('rule-eye')).toEqual({ kind: 'rule', id: 'eye' })
    expect(parseNode('place-vault')).toEqual({ kind: 'place', id: 'vault' })
    expect(parseNode('ch-4:beats')).toEqual({ kind: 'beats', chapterId: 'ch-4' })
    expect(parseNode('ch-4:draft')).toEqual({ kind: 'draft', chapterId: 'ch-4' })
    expect(parseNode('ch-4:review')).toEqual({ kind: 'review', chapterId: 'ch-4' })
    expect(parseNode('ch-5')).toEqual({ kind: 'chapter', id: 'ch-5' })
  })

  it('设定集叶子归 L2；章内子页带出工作章', () => {
    expect(layerOf(parseNode('person-gu'))).toBe('bible')
    expect(layerOf(parseNode('engine'))).toBeNull()
    expect(workChapterId(parseNode('pitch'))).toBe('')
    expect(workChapterId(parseNode('engine'))).toBe('')
    expect(workChapterId(parseNode('ch-1:draft'))).toBe('ch-1')
    expect(jumpNode('beats', 'ch-1')).toBe(beatsNode('ch-1'))
    expect(jumpNode('volume', 'ch-1', YANPIN_EYE)).toBe('vol-1')
    expect(jumpNode('unit', 'ch-1', YANPIN_EYE)).toBe(YANPIN_EYE.units[0]?.id)
  })

  it('四个工作面按节点分流', () => {
    expect(modeOf(parseNode('pitch'))).toBe('set')
    expect(modeOf(parseNode('person-shen'))).toBe('set')
    expect(modeOf(parseNode('outline'))).toBe('plan')
    expect(modeOf(parseNode('ch-4:beats'))).toBe('plan')
    expect(modeOf(parseNode('ch-4:draft'))).toBe('draft')
    expect(modeOf(parseNode('ch-4:review'))).toBe('check')
    expect(jumpMode('draft', YANPIN_EYE, 'ch-4')).toBe('ch-4:draft')
  })

  it('第1–4章有完整栈，第5章没有', () => {
    expect(chapterHasStack(YANPIN_EYE, 'ch-1')).toEqual({
      beats: true,
      draft: true,
      review: true,
    })
    expect(chapterHasStack(YANPIN_EYE, 'ch-4')).toEqual({
      beats: true,
      draft: true,
      review: true,
    })
    expect(chapterHasStack(YANPIN_EYE, 'ch-5')).toEqual({
      beats: false,
      draft: false,
      review: false,
    })
  })
})
