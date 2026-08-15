import { describe, expect, it } from 'vitest'
import {
  isWorkflowLive,
  parseWorkflowAgentOutputs,
  partitionWorkflowCards,
  workflowAgentStateLabel,
  workflowAgentUiStatus,
  workflowResultHeadline,
  workflowStatusLabel,
} from './workflowCards'

describe('workflowResultHeadline', () => {
  it('抽出 parallel 数组里的 output，不展示 compact JSON', () => {
    const raw = JSON.stringify([{ agent_id: 'a1', output: '# Title\nline' }])
    expect(workflowResultHeadline(raw)).toBe('Title line')
    expect(workflowResultHeadline(raw)).not.toContain('agent_id')
  })

  it('多项数组汇总标题', () => {
    const raw = JSON.stringify([{ output: 'one' }, { output: 'two' }])
    expect(workflowResultHeadline(raw)).toBe('完成 2 项：one、two')
  })

  it('兼容 {results:[title]} 与 {output}', () => {
    expect(
      workflowResultHeadline(JSON.stringify({ count: 2, results: [{ title: 'a' }, { title: 'b' }] })),
    ).toBe('完成 2 项：a、b')
    expect(workflowResultHeadline(JSON.stringify({ output: 'hello\nworld' }))).toBe('hello world')
  })

  it('字面量 \\n 的非 JSON 残片压成一行并截断', () => {
    const raw = `not-json ${'x'.repeat(200)}\\nmore`
    const h = workflowResultHeadline(raw)
    expect(h.endsWith('…')).toBe(true)
    expect(h.length).toBe(161)
    expect(h).not.toContain('\\n')
  })
})

describe('partitionWorkflowCards', () => {
  it('只钉运行中 + 最近一次已结束，更早的收进历史', () => {
    const items = [
      { runId: '1', status: 'complete' },
      { runId: '2', status: 'completed' },
      { runId: '3', status: 'running' },
      { runId: '4', status: 'failed' },
    ]
    const p = partitionWorkflowCards(items)
    expect(p.live.map((w) => w.runId)).toEqual(['3'])
    expect(p.latestSettled?.runId).toBe('4')
    expect(p.olderSettled.map((w) => w.runId)).toEqual(['2', '1'])
  })

  it('没有已结束时不捏造最近一条', () => {
    const p = partitionWorkflowCards([{ runId: 'r', status: 'paused' }])
    expect(p.live).toHaveLength(1)
    expect(p.latestSettled).toBeNull()
    expect(p.olderSettled).toEqual([])
  })
})

describe('workflowStatusLabel', () => {
  it('complete / completed 都显示完成', () => {
    expect(isWorkflowLive('complete')).toBe(false)
    expect(workflowStatusLabel('complete')).toBe('完成')
    expect(workflowStatusLabel('completed')).toBe('完成')
    expect(workflowAgentStateLabel('done')).toBe('完成')
    expect(workflowAgentStateLabel('running')).toBe('运行中')
    expect(workflowAgentUiStatus('done')).toBe('completed')
    expect(workflowAgentStateLabel('budget_limited')).toBe('超出预算')
    expect(workflowStatusLabel('budget_limited')).toBe('超出预算')
  })
})

describe('parseWorkflowAgentOutputs', () => {
  it('按 agent_id 抽出 parallel 数组里的 output', () => {
    const raw = JSON.stringify([
      { agent_id: 'a1', output: '# Title\nline' },
      { agent_id: 'a2', success: true, output: 'two' },
    ])
    const m = parseWorkflowAgentOutputs(raw)
    expect(m.get('a1')).toBe('# Title\nline')
    expect(m.get('a2')).toBe('two')
  })
})
