import { describe, expect, it } from 'vitest'
import {
  canDisableTool,
  mergeComposition,
  patchDisabledTools,
} from './toolDisable'
import { emptyComposition } from './composition'

describe('canDisableTool', () => {
  it('只认组装单允许的官方名', () => {
    expect(canDisableTool('web_search')).toBe(true)
    expect(canDisableTool('skill')).toBe(false)
    expect(canDisableTool('spawn_subagent')).toBe(false)
  })
})

describe('patchDisabledTools', () => {
  it('按官方顺序去重', () => {
    expect(patchDisabledTools(['web_search'], 'grep', true)).toEqual([
      'web_search',
      'grep',
    ])
    expect(patchDisabledTools(['web_search', 'grep'], 'web_search', false)).toEqual(
      ['grep'],
    )
  })
})

describe('mergeComposition', () => {
  it('补齐缺省 tools.disable', () => {
    const merged = mergeComposition({
      ...emptyComposition(),
      tools: { disable: ['read_file'] },
    })
    expect(merged.tools.disable).toEqual(['read_file'])
    expect(mergeComposition(null).tools.disable).toEqual([])
  })
})
