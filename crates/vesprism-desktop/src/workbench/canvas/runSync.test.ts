import { describe, expect, it } from 'vitest'
import {
  applyRunToSteps,
  dockRunStatus,
  matchStepPhase,
  workflowBelongsToRun,
  type SubmittedRun,
} from './runSync'
import type { WorkflowInfoDto } from '../../lib/composition'

function submitted(partial?: Partial<SubmittedRun>): SubmittedRun {
  return {
    keys: new Set(['old-run']),
    id: 'ship',
    baseId: 'ship',
    name: '发版',
    ...partial,
  }
}

describe('workflowBelongsToRun', () => {
  it('按 id 认，不靠显示名撞车', () => {
    const s = submitted()
    expect(workflowBelongsToRun({ runId: 'r1', name: 'ship' }, s)).toBe(true)
    expect(workflowBelongsToRun({ runId: 'r1', name: '/ship' }, s)).toBe(true)
    expect(workflowBelongsToRun({ runId: 'old-run', name: 'ship' }, s)).toBe(false)
    expect(workflowBelongsToRun({ runId: 'r2', name: '发版' }, s)).toBe(false)
    expect(workflowBelongsToRun({ runId: 'r3', name: '别的流程也叫发版' }, s)).toBe(false)
  })

  it('从此处重跑用 -rerun id', () => {
    const s = submitted({ id: 'ship-rerun' })
    expect(workflowBelongsToRun({ runId: 'n', name: 'ship-rerun' }, s)).toBe(true)
    expect(workflowBelongsToRun({ runId: 'n', name: 'ship' }, s)).toBe(false)
  })
})

describe('matchStepPhase / applyRunToSteps', () => {
  it('优先用 title 里的精确 nodeId，不 includes 误配 agent-10', () => {
    const phases = [
      { title: '摘要 · agent-1', state: 'completed' },
      { title: '摘要 · agent-10', state: 'running' },
      { title: '摘要 · agent-2', state: 'failed' },
    ]
    expect(matchStepPhase(phases, { nodeId: 'agent-1', label: '摘要' })?.state).toBe('completed')
    expect(matchStepPhase(phases, { nodeId: 'agent-10', label: '摘要' })?.state).toBe('running')
    expect(matchStepPhase(phases, { nodeId: 'agent-2', label: '摘要' })?.state).toBe('failed')
  })

  it('不把全局 lastEventDetail 写到每个完成节点', () => {
    const run = {
      runId: 'r1',
      revision: 1,
      name: 'ship',
      objective: '',
      status: 'running',
      foreground: true,
      phases: [
        { title: '摘要 · agent-1', state: 'completed' },
        { title: '终点 · end-1', state: 'running' },
      ],
      currentPhase: '终点 · end-1',
      agentsUsed: 0,
      agentsReserved: 0,
      agentUsageIncomplete: false,
      elapsedMs: 0,
      activeAgents: 1,
      agents: [],
      lastEventDetail: 'only-current',
    } as WorkflowInfoDto
    const { steps, outputs } = applyRunToSteps(
      [
        { nodeId: 'agent-1', label: '摘要', type: 'agent', status: 'running' },
        { nodeId: 'end-1', label: '终点', type: 'end', status: 'pending' },
      ],
      run,
    )
    expect(steps[0].status).toBe('completed')
    expect(steps[0].output).toBeUndefined()
    expect(steps[1].status).toBe('running')
    expect(steps[1].output).toBe('only-current')
    expect(outputs).toEqual([{ nodeId: 'end-1', output: 'only-current', status: 'running' }])
  })

  it('当前 running 步骤记下 lastEventDetail，供从此处重跑当上游', () => {
    const run = {
      runId: 'r1',
      revision: 1,
      name: 'ship',
      objective: '',
      status: 'running',
      foreground: true,
      phases: [
        { title: '摘要 · agent-1', state: 'completed' },
        { title: '审查 · agent-2', state: 'running' },
      ],
      currentPhase: '审查 · agent-2',
      agentsUsed: 0,
      agentsReserved: 0,
      agentUsageIncomplete: false,
      elapsedMs: 0,
      activeAgents: 1,
      agents: [],
      lastEventDetail: '{"score":9}',
    } as WorkflowInfoDto
    const { steps, outputs } = applyRunToSteps(
      [
        { nodeId: 'agent-1', label: '摘要', type: 'agent', status: 'completed' },
        { nodeId: 'agent-2', label: '审查', type: 'agent', status: 'pending' },
      ],
      run,
    )
    expect(steps[0].output).toBeUndefined()
    expect(steps[1].status).toBe('running')
    expect(steps[1].output).toBe('{"score":9}')
    expect(outputs).toEqual([{ nodeId: 'agent-2', output: '{"score":9}', status: 'running' }])
  })
})

describe('dockRunStatus', () => {
  it('全 pending 显示进行中，不是完成', () => {
    expect(dockRunStatus([{ status: 'pending' }, { status: 'pending' }])).toBe('进行中')
    expect(dockRunStatus([{ status: 'completed' }, { status: 'completed' }])).toBe('完成')
    expect(dockRunStatus([{ status: 'running' }])).toBe('运行中')
    expect(dockRunStatus([])).toBe('待运行')
  })
})
