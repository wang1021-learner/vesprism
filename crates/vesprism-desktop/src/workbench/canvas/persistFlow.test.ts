import { afterEach, describe, expect, it } from 'vitest'
import { createBlankDraft, createDemoDraft, saveHash, type FlowGraphNode } from '../flow'
import {
  compileDraftRhai,
  draftAfterPersist,
  enqueueFlowWrite,
  pendingFlowWrites,
  presetsFromAgentList,
  resetFlowWriteQueueForTests,
  shouldSkipDraftPersist,
} from './persistFlow'
import type { AgentListItem } from '../types'

describe('draftAfterPersist', () => {
  it('内容没变则清 dirty，不看 nodes 引用', () => {
    const prev = { ...createDemoDraft(), dirty: true, id: 'ship' }
    const persisted = { ...prev, nodes: prev.nodes.map((n) => ({ ...n })), dirty: true }
    expect(prev.nodes).not.toBe(persisted.nodes)
    const next = draftAfterPersist(prev, persisted, { published: false, version: '1' }, saveHash(persisted))
    expect(next.dirty).toBe(false)
    expect(next.nodes).toBe(prev.nodes)
  })

  it('保存期间又改了则保持 dirty', () => {
    const prev = { ...createDemoDraft(), dirty: true, id: 'ship', name: '新名字' }
    const persisted = { ...createDemoDraft(), dirty: true, id: 'ship', name: '旧名字' }
    const next = draftAfterPersist(prev, persisted, { published: true, version: '2' }, saveHash(prev))
    expect(next.dirty).toBe(true)
    expect(next.name).toBe('新名字')
    expect(next.published).toBe(true)
    expect(next.version).toBe('2')
  })

  it('保存完成时已经切到别的流程，不把旧元数据盖上来', () => {
    const prev = { ...createBlankDraft('untitled-flow-new'), dirty: true }
    const persisted = { ...createDemoDraft(), dirty: true, id: 'ship' }
    const next = draftAfterPersist(prev, persisted, { published: true, version: '9' }, saveHash(prev))
    expect(next).toBe(prev)
    expect(next.id).toBe('untitled-flow-new')
  })
})

afterEach(() => {
  resetFlowWriteQueueForTests()
})

describe('enqueueFlowWrite', () => {
  it('后一次等前一次结束', async () => {
    const order: number[] = []
    const a = enqueueFlowWrite(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
    })
    const b = enqueueFlowWrite(async () => {
      order.push(2)
    })
    await Promise.all([a, b])
    await pendingFlowWrites()
    expect(order).toEqual([1, 2])
  })
})

describe('shouldSkipDraftPersist', () => {
  it('示例流程不落草稿，发布/试跑仍编', () => {
    expect(shouldSkipDraftPersist('demo-linear')).toBe(true)
    expect(shouldSkipDraftPersist('demo-linear', { stage: true })).toBe(false)
    expect(shouldSkipDraftPersist('demo-linear', { publish: true })).toBe(false)
    expect(shouldSkipDraftPersist('ship')).toBe(false)
    expect(shouldSkipDraftPersist('untitled-flow-ab12')).toBe(false)
  })
})

describe('presetsFromAgentList', () => {
  it('用列表自带的 systemPrompt，损坏项跳过', () => {
    const agents: AgentListItem[] = [
      {
        id: 'pr-reviewer',
        name: '审查员',
        version: '1',
        isolation: true,
        capability: 'read_only',
        systemPrompt: '只读审查',
        skills: ['git-workflow'],
        disabled_tools: ['web_search'],
      },
      {
        id: 'broken',
        name: '坏档',
        version: '1',
        isolation: false,
        error: 'yaml 损坏',
      },
    ]
    const got = presetsFromAgentList(agents)
    expect(got.broken).toBeUndefined()
    expect(got['pr-reviewer']?.systemPrompt).toBe('只读审查')
    expect(got['pr-reviewer']?.capability).toBe('read-only')
    expect(got['pr-reviewer']?.disabledTools).toEqual(['web_search'])
    expect(got['pr-reviewer']?.skills).toEqual(['git-workflow'])
  })
})

describe('compileDraftRhai', () => {
  it('只 getFlow 引用到的子流程', async () => {
    const d = createDemoDraft()
    d.id = 'root'
    d.nodes = [
      { id: 's', type: 'start', params: { label: '起点' } },
      { id: 'f', type: 'flow', params: { label: '子', flowId: 'sub-a' } },
      { id: 'e', type: 'end', params: { label: '终点' } },
    ]
    d.edges = [
      { from: 's', to: 'f' },
      { from: 'f', to: 'e' },
    ]
    const seen: string[] = []
    const rhai = await compileDraftRhai(
      d,
      async (id) => {
        seen.push(id)
        const nodes: FlowGraphNode[] = [
          { id: 'start-1', type: 'start', params: { label: 's' } },
          { id: 'agent-1', type: 'agent', params: { label: '摘要', prompt: '写摘要' } },
          { id: 'end-1', type: 'end', params: { label: 'e' } },
        ]
        return {
          nodes,
          edges: [
            { from: 'start-1', to: 'agent-1' },
            { from: 'agent-1', to: 'end-1' },
          ],
        }
      },
      async () => [],
      { current: null },
    )
    expect(seen).toEqual(['sub-a'])
    expect(rhai.length).toBeGreaterThan(10)
  })

  it('改说明或 Agent 编制会让缓存失效', async () => {
    const d = createDemoDraft()
    d.id = 'cache-root'
    const cache: { current: { key: string; rhai: string } | null } = { current: null }
    const getFlow = async () => {
      throw new Error('nope')
    }
    await compileDraftRhai(d, getFlow, async () => [], cache)
    const keyTopo = cache.current?.key
    expect(keyTopo).toBeTruthy()
    d.description = '改过的说明'
    await compileDraftRhai(d, getFlow, async () => [], cache)
    expect(cache.current?.key).not.toBe(keyTopo)
    expect(cache.current?.rhai).toContain('改过的说明')
    const keyDesc = cache.current?.key
    ;(d.nodes[1].params as { presetId?: string }).presetId = 'pr-reviewer'
    await compileDraftRhai(
      d,
      getFlow,
      async () => [
        {
          id: 'pr-reviewer',
          name: '审查员',
          version: '1',
          isolation: true,
          systemPrompt: '只读审查',
        },
      ],
      cache,
    )
    expect(cache.current?.key).not.toBe(keyDesc)
    expect(cache.current?.rhai).toContain('只读审查')
  })

  it('缺子流程直接报错', async () => {
    const d = createDemoDraft()
    d.nodes.push({
      id: 'flow-1',
      type: 'flow',
      params: { flowId: 'gone' },
    })
    await expect(
      compileDraftRhai(
        d,
        async () => {
          throw new Error('nope')
        },
        async () => [],
        { current: null },
      ),
    ).rejects.toThrow(/缺少子流程/)
  })
})
