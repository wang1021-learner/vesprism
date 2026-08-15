import { describe, expect, it } from 'vitest'
import { createDemoDraft } from './graph'
import { compileInlinedRhai, inlineFlowNodes, type FlowCatalog } from './inline'
import { compileToRhai } from './rhai'
import type { FlowDraft } from './types'

function childDraft(): FlowDraft {
  return {
    id: 'child-sum',
    name: '子摘要',
    description: '给 agent 看的说明',
    version: '1',
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    nodes: [
      { id: 's', type: 'start', params: { label: '起点' } },
      {
        id: 'a',
        type: 'agent',
        params: { label: '内联摘要', prompt: '整理成一句话' },
      },
      { id: 'e', type: 'end', params: {} },
    ],
    edges: [
      { from: 's', to: 'a' },
      { from: 'a', to: 'e' },
    ],
  }
}

function parentWithFlow(childId = 'child-sum'): FlowDraft {
  return {
    id: 'parent-flow',
    name: '父流程',
    description: '给 agent 看的说明',
    version: '1',
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    nodes: [
      { id: 's', type: 'start', params: { label: '起点' } },
      { id: 'f', type: 'flow', params: { label: '调子流程', flowId: childId } },
      { id: 'e', type: 'end', params: {} },
    ],
    edges: [
      { from: 's', to: 'f' },
      { from: 'f', to: 'e' },
    ],
  }
}

describe('inlineFlowNodes', () => {
  it('把 flow 节点替换成子图主体并去掉对方 start/end', () => {
    const child = childDraft()
    const catalog: FlowCatalog = { 'child-sum': { nodes: child.nodes, edges: child.edges } }
    const r = inlineFlowNodes(parentWithFlow(), catalog)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.nodes.some((n) => n.type === 'flow')).toBe(false)
    expect(r.draft.nodes.map((n) => n.id).sort()).toEqual(['e', 'f__a', 's'])
    expect(r.draft.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 's', to: 'f__a' }),
        expect.objectContaining({ from: 'f__a', to: 'e' }),
      ]),
    )
    expect(JSON.stringify(r.draft.nodes)).not.toMatch(/position/)
  })

  it('发布编译结果不含 invoke 子流程，只含内联 agent', () => {
    const child = childDraft()
    const catalog: FlowCatalog = { 'child-sum': { nodes: child.nodes, edges: child.edges } }
    const compiled = compileInlinedRhai(parentWithFlow(), catalog, compileToRhai)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(compiled.rhai).toContain('内联摘要')
    expect(compiled.rhai).not.toContain('invoke child-sum')
    expect(compiled.rhai).not.toMatch(/position/)
  })

  it('缺图画 / 循环引用 fail loud', () => {
    const missing = inlineFlowNodes(parentWithFlow(), {})
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatch(/找不到画布图/)

    const a = parentWithFlow('b')
    const b = parentWithFlow('a')
    b.id = 'b'
    a.nodes[1].params = { flowId: 'b' }
    const cycle = inlineFlowNodes(a, {
      a: { nodes: a.nodes, edges: a.edges },
      b: { nodes: b.nodes, edges: b.edges },
    })
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.error).toMatch(/循环引用/)
  })

  it('无 flow 节点时原样返回，demo 仍可编译', () => {
    const demo = createDemoDraft()
    const r = inlineFlowNodes(demo, {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.draft.nodes).toHaveLength(demo.nodes.length)
  })
})
