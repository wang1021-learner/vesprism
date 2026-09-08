import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { findReferences } from './referenceSearch'

describe('溯源引用搜索', () => {
  it('按人名命中人物卡与出场章', () => {
    const refs = findReferences(YANPIN_EYE, '顾晚宁')
    expect(refs.people.some((p) => p.id === 'gu')).toBe(true)
    expect(refs.chapters.some((c) => c.cast.includes('gu'))).toBe(true)
  })

  it('伏笔自由文本里的旧名能命中', () => {
    const book = {
      ...YANPIN_EYE,
      outline: {
        ...YANPIN_EYE.outline,
        foreshadows: [
          ...YANPIN_EYE.outline.foreshadows,
          { id: 'F099', line: '旧友林远山藏着一把钥匙', plantVolume: '', thisVolume: '', closeWhen: '', state: 'open' as const },
        ],
      },
    }
    const refs = findReferences(book, '林远山')
    expect(refs.foreshadows.some((f) => f.line.includes('林远山'))).toBe(true)
    expect(refs.people).toEqual([])
  })

  it('空词返回空结果', () => {
    const refs = findReferences(YANPIN_EYE, '  ')
    expect(refs.chapters).toEqual([])
    expect(refs.foreshadows).toEqual([])
  })
})
