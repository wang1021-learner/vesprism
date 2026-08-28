import { describe, expect, it } from 'vitest'
import {
  applyFlowPatch,
  bumpVersion,
  createDemoDraft,
  layoutDraft,
  layoutGraph,
  sanitizeStartFields,
  subgraphFrom,
  testInputTemplate,
  defaultTestInput,
  isLegacyDefaultTestInput,
  parseTestInputForRun,
  resolveTestInput,
  shouldPersistTestInput,
} from './graph'
import type { FlowDraft, FlowGraphJson, FlowGraphNode } from './types'

describe('graph topological layout & utilities', () => {
  it('sanitizeStartFields 清洗 AI 污染字段名（引号/花括号剔除），非法条目丢弃', () => {
    const cleaned = sanitizeStartFields([
      { name: '{\\"phoneNumber\\"', type: 'string' },
      { name: '"customerName"', type: 'string' },
      { name: 'businessType', type: 'string' },
      { name: 'retryCount', type: 'number' },
      { name: '  有 空格 ', type: 'string' },
      { name: 'bad-type', type: 'weird' },
      { name: '', type: 'string' },
      'not-an-object',
      null,
    ])
    expect(cleaned.map((f) => f.name)).toEqual([
      'phoneNumber',
      'customerName',
      'businessType',
      'retryCount',
      'badtype', // 'weird' 类型回退 string；'  有 空格 ' 全非标识符 → 丢弃
    ])
    expect(cleaned.find((f) => f.name === 'retryCount')?.type).toBe('number')
    expect(cleaned.find((f) => f.name === 'badtype')?.type).toBe('string')
    expect(cleaned.find((f) => f.name === 'phoneNumber')?.required).toBe(true)
  })

  it('testInputTemplate 按 start 字段生成试跑参数模板；无字段返回 null', () => {
    const tpl = testInputTemplate([
      { name: 'phoneNumber', type: 'string', required: true },
      { name: 'customerName', type: 'string', required: true },
      { name: 'retryCount', type: 'number', required: false },
    ])
    expect(tpl).toContain('"phoneNumber": ""')
    expect(tpl).toContain('"customerName": ""')
    expect(tpl).toContain('"retryCount": "0"')
    expect(testInputTemplate([])).toBeNull()
    expect(testInputTemplate(undefined)).toBeNull()
  })

  it('resolveTestInput 忽略旧占位，按 start 字段出模板；用户改过的保留', () => {
    const phone = [{ name: 'phoneNumber', type: 'string' as const, required: true }]
    expect(isLegacyDefaultTestInput('{\n  "input": ""\n}')).toBe(true)
    expect(resolveTestInput('{\n  "input": ""\n}', phone)).toContain('"phoneNumber"')
    expect(resolveTestInput(null, phone)).toContain('"phoneNumber"')
    expect(resolveTestInput('{\n  "phoneNumber": "138"\n}', phone)).toContain('138')
    const onlyInput = [{ name: 'input', type: 'string' as const, required: true }]
    expect(resolveTestInput('{\n  "input": ""\n}', onlyInput)).toContain('"input"')
    expect(defaultTestInput(undefined)).toBe('{\n}')
    expect(shouldPersistTestInput('{\n}', defaultTestInput(phone))).toBe(false)
    expect(shouldPersistTestInput('{\n  "phoneNumber": "138"\n}', defaultTestInput(phone))).toBe(
      true,
    )
    expect(parseTestInputForRun('')).toEqual({ ok: true, value: {} })
    expect(parseTestInputForRun('{\n}')).toEqual({ ok: true, value: {} })
    expect(parseTestInputForRun('{').ok).toBe(false)
  })

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

  it('subgraphFrom 从 join 重跑时拉入兄弟节点，兄弟无入边（由 start-rerun 接入）', () => {
    const nodes: FlowGraphNode[] = [
      { id: 'start', type: 'start', params: {} },
      { id: 'a', type: 'agent', params: {} },
      { id: 'b', type: 'agent', params: {} },
      { id: 'j', type: 'join', params: {} },
      { id: 'end', type: 'end', params: {} },
    ]
    const edges = [
      { from: 'start', to: 'a' },
      { from: 'start', to: 'b' },
      { from: 'a', to: 'j' },
      { from: 'b', to: 'j' },
      { from: 'j', to: 'end' },
    ]
    const sub = subgraphFrom(nodes, edges, 'j')
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'end', 'j'])
    // join 有兄弟入边（不在无入边集合）；a/b 无入边 → 由重跑起点接入，不会成孤岛
    const noIn = sub.nodes.filter((n) => !sub.edges.some((e) => e.to === n.id)).map((n) => n.id)
    expect(noIn.sort()).toEqual(['a', 'b'])
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
