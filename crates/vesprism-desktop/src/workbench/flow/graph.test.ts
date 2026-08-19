import { describe, expect, it } from 'vitest'
import {
  applyFlowPatch,
  bumpVersion,
  createDemoDraft,
  layoutDraft,
  layoutGraph,
  subgraphFrom,
} from './graph'
import type { FlowDraft, FlowGraphJson, FlowGraphNode } from './types'

describe('graph topological layout & utilities', () => {
  it('assigns progressive x-coordinates based on topological layer', () => {
    const graph: FlowGraphJson = {
      nodes: [
        { id: 'start', type: 'start', params: {} },
        { id: 'agent-1', type: 'agent', params: {} },
        { id: 'agent-2', type: 'agent', params: {} },
        { id: 'end', type: 'end', params: {} },
      ],
      edges: [
        { from: 'start', to: 'agent-1' },
        { from: 'agent-1', to: 'agent-2' },
        { from: 'agent-2', to: 'end' },
      ],
    }
    const laid = layoutGraph(graph)
    expect(laid).toHaveLength(4)
    const start = laid.find((n) => n.id === 'start')!
    const a1 = laid.find((n) => n.id === 'agent-1')!
    const a2 = laid.find((n) => n.id === 'agent-2')!
    const end = laid.find((n) => n.id === 'end')!

    expect(start.position!.x).toBeLessThan(a1.position!.x)
    expect(a1.position!.x).toBeLessThan(a2.position!.x)
    expect(a2.position!.x).toBeLessThan(end.position!.x)
  })

  it('layoutDraft updates node positions while preserving metadata and params', () => {
    const draft: FlowDraft = {
      id: 'test-flow',
      name: '测试流程',
      description: '描述',
      version: '1',
      published: false,
      dirty: false,
      input_schema: {},
      output_schema: {},
      nodes: [
        { id: 'start', type: 'start', params: { label: '起点' }, position: { x: 0, y: 0 } },
        { id: 'end', type: 'end', params: { label: '终点' }, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'end' }],
    }
    const laid = layoutDraft(draft)
    expect(laid.dirty).toBe(true)
    expect(laid.nodes[0].position!.x).toBeLessThan(laid.nodes[1].position!.x)
    expect((laid.nodes[0].params as { label?: string }).label).toBe('起点')
  })

  it('bumpVersion increments version correctly', () => {
    expect(bumpVersion('1')).toBe('2')
    expect(bumpVersion('1.0.1')).toBe('1.0.2')
  })

  it('subgraphFrom extracts downstream subgraphs correctly', () => {
    const nodes: FlowGraphNode[] = [
      { id: 'start', type: 'start', params: {} },
      { id: 'a', type: 'agent', params: {} },
      { id: 'b', type: 'agent', params: {} },
      { id: 'end', type: 'end', params: {} },
    ]
    const edges = [
      { from: 'start', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'end' },
    ]
    const sub = subgraphFrom(nodes, edges, 'a')
    expect(sub.nodes.map((n) => n.id)).toEqual(['a', 'b', 'end'])
    expect(sub.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['a->b', 'b->end'])
  })

  it('subgraphFrom 从并行一支重跑时会带上 join 的其它入边', () => {
    const nodes: FlowGraphNode[] = [
      { id: 'start', type: 'start', params: {} },
      { id: 'p', type: 'parallel', params: {} },
      { id: 'a', type: 'agent', params: {} },
      { id: 'b', type: 'agent', params: {} },
      { id: 'j', type: 'join', params: {} },
      { id: 'end', type: 'end', params: {} },
    ]
    const edges = [
      { from: 'start', to: 'p' },
      { from: 'p', to: 'a' },
      { from: 'p', to: 'b' },
      { from: 'a', to: 'j' },
      { from: 'b', to: 'j' },
      { from: 'j', to: 'end' },
    ]
    const sub = subgraphFrom(nodes, edges, 'a')
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'end', 'j'])
    expect(sub.edges.filter((e) => e.to === 'j')).toHaveLength(2)
  })
})

describe('applyFlowPatch', () => {
  it('浅合并 params 并保住原坐标', () => {
    const draft = createDemoDraft()
    const x = draft.nodes[1].position?.x
    const r = applyFlowPatch(draft, {
      update_nodes: [{ id: 'agent-1', params: { role: '安全审计员' } }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const agent = r.draft.nodes.find((n) => n.id === 'agent-1')
    expect((agent?.params as { role?: string }).role).toBe('安全审计员')
    expect((agent?.params as { prompt?: string }).prompt).toBeTruthy()
    expect(agent?.position?.x).toBe(x)
  })
})
