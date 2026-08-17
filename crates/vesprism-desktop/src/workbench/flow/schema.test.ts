import { describe, expect, it } from 'vitest'
import { AI_GRAPH_FAIL_MESSAGE, parseGeneratedGraph, validateFlowGraph } from './schema'
import { createDemoDraft, graphJsonFromDraft, layoutGraph } from './graph'

describe('validateFlowGraph', () => {
  it('接受合法三节点线性图', () => {
    const r = validateFlowGraph(graphJsonFromDraft(createDemoDraft()))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.graph.nodes).toHaveLength(3)
      expect(r.graph.edges).toHaveLength(2)
    }
  })

  it('拒绝非 branch 多出边、branch 不是恰好 2 出边、start-end 无连线', () => {
    const extraOut = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'a', type: 'agent', params: {} },
        { id: 'b', type: 'agent', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'e' },
      ],
    }
    const branch3 = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'br', type: 'branch', params: {} },
        { id: 'x', type: 'agent', params: {} },
        { id: 'y', type: 'agent', params: {} },
        { id: 'z', type: 'agent', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'br' },
        { from: 'br', to: 'x', label: 'success' },
        { from: 'br', to: 'y', label: 'failure' },
        { from: 'br', to: 'z' },
        { from: 'x', to: 'e' },
        { from: 'y', to: 'e' },
        { from: 'z', to: 'e' },
      ],
    }
    const disconnected = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [],
    }
    for (const item of [extraOut, branch3, disconnected]) {
      const r = validateFlowGraph(item)
      expect(r.ok, JSON.stringify(item)).toBe(false)
    }
  })

  it('拒绝缺 start / 缺 end / 非法 type / 悬空边 / 无出边 branch', () => {
    const bad: unknown[] = [
      null,
      { nodes: [], edges: [] },
      { nodes: [{ id: 's', type: 'start', params: {} }], edges: [] },
      {
        nodes: [
          { id: 's', type: 'start', params: {} },
          { id: 'e', type: 'end', params: {} },
          { id: 'x', type: 'loop', params: {} },
        ],
        edges: [{ from: 's', to: 'e' }],
      },
      {
        nodes: [
          { id: 's', type: 'start', params: {} },
          { id: 'e', type: 'end', params: {} },
        ],
        edges: [{ from: 's', to: 'missing' }],
      },
      {
        nodes: [
          { id: 's', type: 'start', params: {} },
          { id: 'b', type: 'branch', params: {} },
          { id: 'e', type: 'end', params: {} },
        ],
        edges: [{ from: 's', to: 'b' }],
      },
    ]
    for (const item of bad) {
      const r = validateFlowGraph(item)
      expect(r.ok, JSON.stringify(item)).toBe(false)
      if (!r.ok) expect(r.error).toBe(AI_GRAPH_FAIL_MESSAGE)
    }
  })

  it('非法 JSON 文本安全报错，不半渲染', () => {
    expect(parseGeneratedGraph('not json').ok).toBe(false)
    expect(parseGeneratedGraph('```json\n{"nodes":1}\n```').ok).toBe(false)
    const ok = parseGeneratedGraph(
      '好的，这是图：\n```json\n{"nodes":[{"id":"s","type":"start","params":{}},{"id":"e","type":"end","params":{}}],"edges":[{"from":"s","to":"e"}]}\n```',
    )
    expect(ok.ok).toBe(true)
  })
})

describe('layoutGraph', () => {
  it('给无坐标图补上 position，不改 id', () => {
    const laid = layoutGraph({
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'a', type: 'agent', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'a' },
        { from: 'a', to: 'e' },
      ],
    })
    expect(laid.map((n) => n.id)).toEqual(['s', 'a', 'e'])
    expect(laid.every((n) => n.position && typeof n.position.x === 'number')).toBe(true)
    expect((laid[1].position?.x ?? 0) > (laid[0].position?.x ?? 0)).toBe(true)
  })
})

