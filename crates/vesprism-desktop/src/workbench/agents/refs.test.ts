import { describe, expect, it } from 'vitest'
import { listItemsUsingAgent } from './refs'
import type { FlowListItem } from '../flow'

function item(partial: Partial<FlowListItem> & { id: string }): FlowListItem {
  return {
    name: partial.id,
    description: '',
    version: '1',
    published: false,
    draft: true,
    dependencies: [],
    preset_ids: [],
    ...partial,
  }
}

describe('listItemsUsingAgent', () => {
  it('只返回 preset_ids 命中的流程', () => {
    const flows = [
      item({ id: 'a', preset_ids: ['pr-reviewer'] }),
      item({ id: 'b', preset_ids: ['other'] }),
      item({ id: 'c', name: '空' }),
    ]
    expect(listItemsUsingAgent(flows, 'pr-reviewer').map((f) => f.id)).toEqual(['a'])
  })
})
