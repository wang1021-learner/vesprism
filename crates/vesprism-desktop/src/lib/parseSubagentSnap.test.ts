import { describe, expect, it } from 'vitest'
import { parseSubagentSnap } from './parseSubagentSnap'
import type { SubagentRuntime } from '../types'

const base: SubagentRuntime = {
  subagentId: 'sa_1',
  parentSessionId: 'p',
  childSessionId: 'c',
  subagentType: 'general-purpose',
  description: 'demo',
  status: 'running',
}

describe('parseSubagentSnap', () => {
  it('兼容 snake_case 与 status 别名', () => {
    const p = parseSubagentSnap(
      {
        status: 'success',
        turn_count: 3,
        tool_call_count: 5,
        tokens_used: 100,
        child_session_id: 'child_x',
      },
      base,
    )
    expect(p.status).toBe('completed')
    expect(p.turnCount).toBe(3)
    expect(p.toolCallCount).toBe(5)
    expect(p.tokensUsed).toBe(100)
    expect(p.childSessionId).toBe('child_x')
  })

  it('兼容嵌套 data + camelCase', () => {
    const p = parseSubagentSnap(
      {
        data: {
          status: 'failed',
          turnCount: 1,
          error: 'boom',
        },
      },
      base,
    )
    expect(p.status).toBe('failed')
    expect(p.turnCount).toBe(1)
    expect(p.error).toBe('boom')
  })
})
