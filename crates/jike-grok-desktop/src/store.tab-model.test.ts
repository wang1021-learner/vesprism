/**
 * Tab 状态默认值与活动灯
 */
import { describe, expect, it } from 'vitest'
import { deriveTabActivity, emptyTabState } from './store'

describe('tab model', () => {
  it('emptyTabState 含 subagents / userQuestion / modelId', () => {
    const s = emptyTabState()
    expect(s.userQuestion).toBeNull()
    expect(s.subagents).toEqual([])
    expect(s.permission).toBeNull()
    expect(s.modelId).toBe('')
    expect(s.reasoningEffort).toBe('medium')
  })

  it('deriveTabActivity 优先级：error > permission > working > idle', () => {
    expect(deriveTabActivity(emptyTabState())).toBe('idle')
    expect(
      deriveTabActivity({ ...emptyTabState(), status: 'generating' }),
    ).toBe('working')
    expect(
      deriveTabActivity({
        ...emptyTabState(),
        permission: {
          id: '1',
          tool: 'x',
          options: [{ id: 'a', name: 'ok' }],
        },
      }),
    ).toBe('permission')
    expect(
      deriveTabActivity({
        ...emptyTabState(),
        userQuestion: {
          requestId: 1,
          toolCallId: 't',
          mode: 'default',
          questions: [],
        },
      }),
    ).toBe('permission')
    expect(deriveTabActivity({ ...emptyTabState(), error: 'boom' })).toBe(
      'error',
    )
  })
})
