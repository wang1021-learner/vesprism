import { describe, expect, it } from 'vitest'
import { createDemoDraft } from '../flow'
import { fromRf, getAncestors, toRfEdges, toRfNodes } from './rfGraph'

describe('rfGraph', () => {
  it('toRf / fromRf 往返保留业务字段，丢掉 execStatus', () => {
    const d = createDemoDraft()
    const ns = toRfNodes(d, { 'agent-1': { output: 'x', status: 'completed', timestamp: 1 } })
    expect(ns.find((n) => n.id === 'agent-1')?.data.execStatus).toBe('done')
    const back = fromRf(ns, toRfEdges(d), d)
    const agent = back.nodes.find((n) => n.id === 'agent-1')
    expect(agent?.params).not.toHaveProperty('execStatus')
    expect(agent?.params).not.toHaveProperty('nodeType')
    expect(agent?.params.label).toBe('摘要')
  })

  it('success/failure handle 补中文边标签', () => {
    const d = createDemoDraft()
    d.edges = [{ id: 'e1', from: 'a', to: 'b', sourceHandle: 'success' }]
    expect(toRfEdges(d)[0].label).toBe('成功')
  })

  it('getAncestors 沿入边回溯', () => {
    const got = getAncestors('c', [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'x', to: 'y' },
    ])
    expect([...got].sort()).toEqual(['a', 'b'])
  })
})
