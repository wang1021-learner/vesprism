import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { complianceHits, complianceTokens, effectiveComplianceBan } from './compliance'

describe('平台红线', () => {
  it('没配词表不误报', () => {
    expect(effectiveComplianceBan(YANPIN_EYE)).toEqual([])
    expect(complianceHits(YANPIN_EYE, '随便写一段')).toEqual([])
  })

  it('分词表并按正文命中', () => {
    const book = {
      ...YANPIN_EYE,
      canon: { ...YANPIN_EYE.canon, complianceBan: '血洗；屠城；未成年' },
    }
    expect(effectiveComplianceBan(book)).toEqual(['血洗', '屠城', '未成年'])
    expect(complianceHits(book, '他下令屠城。')).toEqual(['屠城'])
    expect(complianceHits(book, '只是散步。')).toEqual([])
  })

  it('单字短词忽略，避免误伤', () => {
    expect(complianceTokens('杀；血；灭了')).toEqual(['灭了'])
  })

  it('起点可单独配红线，空则回落', () => {
    const book = {
      ...YANPIN_EYE,
      canon: { ...YANPIN_EYE.canon, complianceBan: '血洗；屠城', complianceBanQidian: '血洗；低俗' },
    }
    expect(complianceHits(book, '他下令屠城。')).toEqual(['屠城'])
    expect(complianceHits(book, '他下令屠城。', 'qidian')).toEqual([])
    expect(complianceHits(book, '低俗内容。', 'qidian')).toEqual(['低俗'])
  })
})
