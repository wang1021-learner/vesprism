import { describe, expect, it } from 'vitest'
import {
  buildNamedWorkflowSlash,
  isNamedWorkflowSlash,
  isWorkflowEffort,
} from './namedWorkflowSlash'

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

describe('isNamedWorkflowSlash', () => {
  it('认画布试跑实际发出的斜杠（含默认 --effort）', () => {
    const wire = buildNamedWorkflowSlash({
      id: 'demo-linear',
      input: { input: '' },
      effort: 'medium',
    })
    expect(wire).toBe('/demo-linear --effort medium {"input":""}')
    expect(isNamedWorkflowSlash(wire)).toBe(true)
    expect(
      isNamedWorkflowSlash(buildNamedWorkflowSlash({ id: 'ship', effort: 'medium' })),
    ).toBe(true)
    expect(isNamedWorkflowSlash('/demo-linear')).toBe(true)
    expect(isNamedWorkflowSlash('/demo-linear {}')).toBe(true)
    expect(isNamedWorkflowSlash('/demo-linear{"ok":1}')).toBe(true)
    expect(
      isNamedWorkflowSlash(
        '/demo-linear-rerun --effort=high --agent-budget 8 {"phoneNumber":"1"}',
      ),
    ).toBe(true)
  })

  it('不把文件路径、编码斜杠、普通对话当试跑', () => {
    expect(isNamedWorkflowSlash('/app/src/auth.ts 请帮我分析并画出认证流程')).toBe(false)
    expect(isNamedWorkflowSlash('/etc/nginx')).toBe(false)
    expect(isNamedWorkflowSlash('/goal 做个外呼流程')).toBe(false)
    expect(isNamedWorkflowSlash('demo-linear --effort medium')).toBe(false)
    expect(isNamedWorkflowSlash('画一个流程')).toBe(false)
  })
})
