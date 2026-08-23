import { describe, expect, it } from 'vitest'
import type { WorkflowInfoDto } from './composition'
import type { SubagentRuntime } from '../types'
import {
  EMPTY_PHASE_TITLE,
  ORPHAN_RUN_ID,
  buildRunForest,
  buildRunTree,
  dotState,
  isQuietDone,
} from './subagentRunTree'

function wf(partial: Partial<WorkflowInfoDto> & { runId: string }): WorkflowInfoDto {
  return {
    revision: 1,
    name: 'run',
    objective: '',
    status: 'complete',
    foreground: false,
    phases: [],
    agentsUsed: 0,
    agentsReserved: 0,
    agentUsageIncomplete: false,
    elapsedMs: 0,
    activeAgents: 0,
    agents: [],
    ...partial,
  }
}

function agent(
  id: string,
  extra: Partial<WorkflowInfoDto['agents'][number]> = {},
): WorkflowInfoDto['agents'][number] {
  return {
    agentId: id,
    label: extra.label ?? id,
    state: extra.state ?? 'done',
    tokensUsed: extra.tokensUsed ?? 0,
    durationMs: extra.durationMs ?? 0,
    phase: extra.phase,
    model: extra.model,
  }
}

function sub(id: string, extra: Partial<SubagentRuntime> = {}): SubagentRuntime {
  return {
    subagentId: id,
    parentSessionId: 'p',
    childSessionId: extra.childSessionId ?? id,
    subagentType: 'general-purpose',
    description: extra.description ?? '',
    status: extra.status ?? 'completed',
    ...extra,
  }
}

describe('dotState / isQuietDone', () => {
  it('认官方 complete / done，不是 completed', () => {
    expect(dotState('complete')).toBe('done')
    expect(dotState('done')).toBe('done')
    expect(dotState('active')).toBe('ongoing')
    expect(dotState('running')).toBe('ongoing')
    expect(isQuietDone('complete')).toBe(true)
    expect(isQuietDone('done')).toBe(true)
    expect(isQuietDone('failed')).toBe(false)
  })
})

describe('buildRunTree', () => {
  it('按 agents[].phase 对齐 phases[].title 分组', () => {
    const tree = buildRunTree(
      wf({
        runId: 'r1',
        status: 'active',
        phases: [
          { title: 'research', state: 'done' },
          { title: 'write', state: 'active' },
        ],
        agents: [
          agent('a1', { phase: 'research', state: 'done', label: 'one' }),
          agent('a2', { phase: 'write', state: 'running', label: 'two' }),
        ],
      }),
      [],
    )
    expect(tree.phases.map((p) => p.title)).toEqual(['research', 'write'])
    expect(tree.phases[0].members.map((m) => m.agentId)).toEqual(['a1'])
    expect(tree.phases[1].members.map((m) => m.agentId)).toEqual(['a2'])
    expect(tree.runRequiresExpansion).toBe(true)
  })

  it('无 phase 时收成一桶「子代理」，不叫运行中', () => {
    const tree = buildRunTree(
      wf({
        runId: 'r2',
        status: 'complete',
        agents: [agent('a1', { state: 'done' }), agent('a2', { state: 'done' })],
      }),
      [],
    )
    expect(tree.phases).toHaveLength(1)
    expect(tree.phases[0].title).toBe(EMPTY_PHASE_TITLE)
    expect(tree.phases[0].members).toHaveLength(2)
    expect(tree.runRequiresExpansion).toBe(false)
  })

  it('agents 为空时不把会话里其它子代理塞进这棵树', () => {
    const tree = buildRunTree(
      wf({ runId: 'empty', agents: [] }),
      [sub('orphan', { description: '散装' })],
    )
    expect(tree.phases).toEqual([])
    expect(tree.agentsUsed).toBe(0)
  })

  it('childSessionId 缺省用 agentId；output 从 resultSummary 按 id 抽', () => {
    const raw = JSON.stringify([{ agent_id: 'a1', output: '# Title\nline' }])
    const tree = buildRunTree(
      wf({
        runId: 'r3',
        agents: [agent('a1', { state: 'done' })],
        resultSummary: raw,
      }),
      [],
    )
    expect(tree.phases[0].members[0].childSessionId).toBe('a1')
    expect(tree.phases[0].members[0].output).toBe('# Title\nline')
    expect(tree.resultHeadline).toBe('Title line')
  })

  it('resultSummary 为 done 时不展示整段摘要', () => {
    const tree = buildRunTree(wf({ runId: 'r4', resultSummary: 'done', agents: [] }), [])
    expect(tree.resultHeadline).toBe('')
  })
})

describe('buildRunForest', () => {
  it('没有 workflow 时散装 spawn 自成一棵派生子代理', () => {
    const forest = buildRunForest([], [sub('x', { description: '散装' })])
    expect(forest).toHaveLength(1)
    expect(forest[0].runId).toBe(ORPHAN_RUN_ID)
    expect(forest[0].phases[0].members.map((m) => m.agentId)).toEqual(['x'])
  })

  it('有 run 时把没认领的 spawn 收成派生子代理', () => {
    const forest = buildRunForest(
      [
        wf({
          runId: 'wf1',
          status: 'complete',
          agents: [agent('a1', { state: 'done' })],
        }),
      ],
      [sub('a1'), sub('loose', { description: '散装', status: 'running' })],
    )
    expect(forest.map((t) => t.runId)).toEqual([ORPHAN_RUN_ID, 'wf1'])
    const orphan = forest[0]
    expect(orphan.name).toBe('派生子代理')
    expect(orphan.phases[0].members.map((m) => m.agentId)).toEqual(['loose'])
    expect(orphan.runRequiresExpansion).toBe(true)
  })

  it('散装成员带上最近工具', () => {
    const forest = buildRunForest([], [
      sub('x', { description: '查', status: 'running', toolsUsed: ['grep'] }),
    ])
    expect(forest[0].phases[0].members[0].toolsUsed).toEqual(['grep'])
  })
})
