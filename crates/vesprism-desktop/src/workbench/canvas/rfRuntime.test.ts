import { describe, expect, it } from 'vitest'
import { stripRfRuntime } from './rfRuntime'

describe('stripRfRuntime', () => {
  it('剔除 execStatus / 回调，保留业务 params', () => {
    const params = stripRfRuntime({
      nodeType: 'agent',
      execStatus: 'done',
      execDuration: 1200,
      diffGlow: 'add',
      onRunFromHere: () => {},
      onDuplicate: () => {},
      onDeleteNode: () => {},
      selected: true,
      label: '摘要',
      prompt: '分析需求',
      isolation: false,
    })
    expect(params).toEqual({
      label: '摘要',
      prompt: '分析需求',
      isolation: false,
    })
    expect(params).not.toHaveProperty('execStatus')
    expect(params).not.toHaveProperty('diffGlow')
    expect(params).not.toHaveProperty('onRunFromHere')
  })
})
