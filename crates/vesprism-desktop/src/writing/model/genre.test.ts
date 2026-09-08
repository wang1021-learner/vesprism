import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { coldStartLine, genreContractLines, genreContractOf } from './genre'

describe('类型套路契约', () => {
  it('没类型就没有契约', () => {
    expect(genreContractOf('')).toBeNull()
    expect(genreContractLines(YANPIN_EYE)).toEqual([])
  })

  it('模糊匹配类型', () => {
    expect(genreContractOf('玄幻修真·高武')?.label).toBe('玄幻修真')
    expect(genreContractOf('系统流')?.label).toBe('系统文')
  })

  it('契约行注入', () => {
    const book = { ...YANPIN_EYE, pitch: { ...YANPIN_EYE.pitch, genre: '都市爽文' } }
    expect(genreContractLines(book).join('')).toMatch(/前 5 章/)
  })

  it('冷启动前 30 章提示，30 章后不提示', () => {
    expect(coldStartLine(1)).toMatch(/冷启动/)
    expect(coldStartLine(30)).toMatch(/冷启动/)
    expect(coldStartLine(31)).toBeNull()
  })
})
