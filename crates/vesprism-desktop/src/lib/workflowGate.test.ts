import { describe, expect, it } from 'vitest'
import { parseWorkflowInvocation, workflowSendAllowed } from './workflowGate'

describe('parseWorkflowInvocation', () => {
  it('控制命令放行', () => {
    expect(parseWorkflowInvocation('/workflow')).toEqual({ kind: 'control' })
    expect(parseWorkflowInvocation('/workflow list')).toEqual({ kind: 'control' })
    expect(parseWorkflowInvocation('/workflow pause demo-linear')).toEqual({ kind: 'control' })
    expect(parseWorkflowInvocation('/workflow resume demo-linear')).toEqual({ kind: 'control' })
    expect(parseWorkflowInvocation('/workflow stop demo-linear')).toEqual({ kind: 'control' })
    expect(parseWorkflowInvocation('/workflow save')).toEqual({ kind: 'control' })
  })

  it('具名 /workflow id 与 /id 试跑', () => {
    expect(parseWorkflowInvocation('/workflow demo-linear')).toEqual({
      kind: 'named',
      id: 'demo-linear',
    })
    expect(parseWorkflowInvocation('/demo-linear {"q":1}')).toEqual({
      kind: 'named',
      id: 'demo-linear',
    })
    expect(parseWorkflowInvocation('/goal 做个流程')).toEqual({ kind: 'none' })
    expect(parseWorkflowInvocation('普通句子')).toEqual({ kind: 'none' })
  })
})

describe('workflowSendAllowed', () => {
  it('没有白名单时全部放行', () => {
    expect(workflowSendAllowed('/other-flow', undefined).ok).toBe(true)
    expect(workflowSendAllowed('/other-flow', []).ok).toBe(true)
  })

  it('有白名单时拦住未挂载的具名工作流', () => {
    const allow = ['demo-linear']
    expect(workflowSendAllowed('/demo-linear', allow)).toEqual({ ok: true })
    expect(workflowSendAllowed('/workflow demo-linear', allow)).toEqual({ ok: true })
    expect(workflowSendAllowed('/workflow pause demo-linear', allow)).toEqual({ ok: true })
    expect(workflowSendAllowed('/other-flow', allow)).toEqual({ ok: false, id: 'other-flow' })
    expect(workflowSendAllowed('/workflow other-flow', allow)).toEqual({
      ok: false,
      id: 'other-flow',
    })
  })
})
