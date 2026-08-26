import { describe, expect, it } from 'vitest'
import { buildNamedWorkflowSlash, isWorkflowEffort } from './namedWorkflowSlash'

describe('buildNamedWorkflowSlash', () => {
  it('空输入只发 /id', () => {
    expect(buildNamedWorkflowSlash({ id: 'ship' })).toBe('/ship')
    expect(buildNamedWorkflowSlash({ id: '/ship', input: {} })).toBe('/ship')
  })

  it('旗标在 JSON 前，不把 effort 写进 JSON', () => {
    expect(
      buildNamedWorkflowSlash({
        id: 'ship',
        input: { phoneNumber: '1' },
        effort: 'High',
        agentBudget: 32,
      }),
    ).toBe('/ship --effort high --agent-budget 32 {"phoneNumber":"1"}')
  })

  it('不认识的 effort 丢掉，避免官方拒收', () => {
    expect(isWorkflowEffort('medium')).toBe(true)
    expect(isWorkflowEffort('turbo')).toBe(false)
    expect(
      buildNamedWorkflowSlash({
        id: 'ship',
        input: { q: 'a' },
        effort: 'turbo',
      }),
    ).toBe('/ship {"q":"a"}')
  })

  it('预算必须是正整数', () => {
    expect(buildNamedWorkflowSlash({ id: 'ship', agentBudget: 0 })).toBe('/ship')
    expect(buildNamedWorkflowSlash({ id: 'ship', agentBudget: 8.9 })).toBe(
      '/ship --agent-budget 8',
    )
  })
})
