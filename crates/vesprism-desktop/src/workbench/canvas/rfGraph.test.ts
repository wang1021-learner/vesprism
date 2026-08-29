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

  it('success/failure handle 展示中文，落盘仍是英文', () => {
    const d = createDemoDraft()
    d.edges = [{ id: 'e1', from: 'a', to: 'b', sourceHandle: 'success' }]
    const rf = toRfEdges(d)
    expect(rf[0].label).toBe('成功')
    const back = fromRf(toRfNodes(d), rf, d)
    expect(back.edges[0].label).toBe('success')
    expect(back.edges[0].sourceHandle).toBe('success')
  })

  it('fromRf 把展示用的「失败」收成 failure', () => {
    const d = createDemoDraft()
    const ns = toRfNodes(d)
    const es = [
      {
        id: 'e1',
        source: 'a',
        target: 'b',
        sourceHandle: 'failure',
        label: '失败',
      },
    ]
    const back = fromRf(ns, es as ReturnType<typeof toRfEdges>, d)
    expect(back.edges[0].label).toBe('failure')
    expect(back.edges[0].sourceHandle).toBe('failure')
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
