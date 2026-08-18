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

  it('接受 parallel 扇出与 join 汇聚，以及多路 branch', () => {
    const parallelGraph = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'par', type: 'parallel', params: {} },
        { id: 'a1', type: 'agent', params: {} },
        { id: 'a2', type: 'agent', params: {} },
        { id: 'j', type: 'join', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'par' },
        { from: 'par', to: 'a1' },
        { from: 'par', to: 'a2' },
        { from: 'a1', to: 'j' },
        { from: 'a2', to: 'j' },
        { from: 'j', to: 'e' },
      ],
    }
    const r = validateFlowGraph(parallelGraph)
    expect(r.ok).toBe(true)

    const multiBranch = {
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
        { from: 'br', to: 'x', label: 'opt1' },
        { from: 'br', to: 'y', label: 'opt2' },
        { from: 'br', to: 'z', label: 'opt3' },
        { from: 'x', to: 'e' },
        { from: 'y', to: 'e' },
        { from: 'z', to: 'e' },
      ],
    }
    const r2 = validateFlowGraph(multiBranch)
    expect(r2.ok).toBe(true)
  })

  it('拒绝 parallel 嵌套串行复杂子链，给出友好提示', () => {
    const complexParallel = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'par', type: 'parallel', params: {} },
        { id: 'a1', type: 'agent', params: {} },
        { id: 'a1_sub', type: 'agent', params: {} }, // 嵌套串行子节点
        { id: 'a2', type: 'agent', params: {} },
        { id: 'j', type: 'join', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'par' },
        { from: 'par', to: 'a1' },
        { from: 'a1', to: 'a1_sub' }, // 违规：未直接连到 join
        { from: 'a1_sub', to: 'j' },
        { from: 'par', to: 'a2' },
        { from: 'a2', to: 'j' },
        { from: 'j', to: 'e' },
      ],
    }
    const r = validateFlowGraph(complexParallel)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('需直接连入汇聚网关 (join)')
    }
  })

  it('拒绝非 branch/parallel 多出边、join 入度不足 2、start-end 无连线', () => {
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
    const joinOnly1In = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'j', type: 'join', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'j' },
        { from: 'j', to: 'e' },
      ],
    }
    const disconnected = {
      nodes: [
        { id: 's', type: 'start', params: {} },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [],
    }
    for (const item of [extraOut, joinOnly1In, disconnected]) {
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

