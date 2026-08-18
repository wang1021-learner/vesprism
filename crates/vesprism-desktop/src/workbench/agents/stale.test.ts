import { afterEach, describe, expect, it } from 'vitest'
import { clearFlowStale, listStaleForAgent, markFlowsStale, resetFlowStale, staleForFlow } from './stale'

afterEach(() => {
  resetFlowStale()
})

describe('编制变更过期标记', () => {
  it('标记已发布流程，按流程查询，发布后可清', () => {
    markFlowsStale('pr-reviewer', [
      { id: 'review', name: '审查' },
      { id: 'audit', name: '审计' },
    ])
    expect(staleForFlow('review')?.agentId).toBe('pr-reviewer')
    expect(listStaleForAgent('pr-reviewer')).toHaveLength(2)
    clearFlowStale('review')
    expect(staleForFlow('review')).toBeNull()
    expect(staleForFlow('audit')?.flowName).toBe('审计')
  })
})
