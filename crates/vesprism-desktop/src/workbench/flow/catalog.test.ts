import { describe, expect, it } from 'vitest'
import { loadReferencedCatalog, referencedFlowIds } from './catalog'
import type { FlowDraft, FlowGraphNode } from './types'

function node(id: string, type: FlowGraphNode['type'], params: FlowGraphNode['params'] = {}): FlowGraphNode {
  return { id, type, params: { label: id, ...params } }
}

const draft = (nodes: FlowGraphNode[]): FlowDraft => ({
  id: 'root',
  name: '根',
  description: '',
  version: '1',
  input_schema: {},
  output_schema: {},
  nodes,
  edges: [],
})

describe('referencedFlowIds', () => {
  it('只收集 flow 节点的 flowId', () => {
    expect(
      referencedFlowIds([
        node('a', 'agent'),
        node('f1', 'flow', { flowId: 'sub-a' }),
        node('f2', 'flow', { flowId: '  ' }),
      ]),
    ).toEqual(['sub-a'])
  })
})

describe('loadReferencedCatalog', () => {
  it('按引用拉，并展开嵌套，不拉无关流程', async () => {
    const db: Record<string, { nodes: FlowGraphNode[]; edges: [] }> = {
      'sub-a': { nodes: [node('x', 'flow', { flowId: 'sub-b' })], edges: [] },
      'sub-b': { nodes: [node('y', 'agent')], edges: [] },
      unused: { nodes: [node('z', 'agent')], edges: [] },
    }
    const got = await loadReferencedCatalog(draft([node('f', 'flow', { flowId: 'sub-a' })]), async (id) => {
      const rec = db[id]
      if (!rec) throw new Error('missing')
      return rec
    })
    expect(Object.keys(got.catalog).sort()).toEqual(['sub-a', 'sub-b'])
    expect(got.missing).toEqual([])
  })

  it('找不到的进 missing', async () => {
    const got = await loadReferencedCatalog(draft([node('f', 'flow', { flowId: 'gone' })]), async () => {
      throw new Error('nope')
    })
    expect(got.catalog).toEqual({})
    expect(got.missing).toEqual(['gone'])
  })
})
