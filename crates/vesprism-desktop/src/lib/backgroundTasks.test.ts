import { describe, expect, it } from 'vitest'
import {
  applyBackgroundTasksSnapshot,
  backgroundToolCallIdSet,
  findBackgroundTaskByToolCallId,
  runningBackgroundTaskEntries,
  upsertBackgroundTaskIncremental,
} from './backgroundTasks'
import type { BackgroundTaskInfo } from '../store'

describe('applyBackgroundTasksSnapshot', () => {
  it('非 truncated：整表替换，并保留同 taskId 的 toolCallId / lastEvents', () => {
    const prev: Record<string, BackgroundTaskInfo> = {
      t1: {
        taskId: 't1',
        command: 'old',
        toolCallId: 'tc-1',
        lastEvents: ['line'],
        status: 'running',
      },
      gone: { taskId: 'gone', command: 'x', status: 'running' },
    }
    const next = applyBackgroundTasksSnapshot(
      prev,
      [
        {
          taskId: 't1',
          command: 'sleep 1',
          displayCommand: 'sleep',
          status: 'running',
          kind: 'bash',
        },
        {
          taskId: 't2',
          command: 'watch',
          status: 'running',
          kind: 'monitor',
          description: '监视部署',
        },
      ],
      false,
    )
    expect(Object.keys(next).sort()).toEqual(['t1', 't2'])
    expect(next.t1.toolCallId).toBe('tc-1')
    expect(next.t1.lastEvents).toEqual(['line'])
    expect(next.t1.command).toBe('sleep')
    expect(next.t2.monitorDescription).toBe('监视部署')
    expect(next.gone).toBeUndefined()
  })

  it('空快照且非 truncated：清空', () => {
    const next = applyBackgroundTasksSnapshot(
      { t1: { taskId: 't1', command: 'x', status: 'running' } },
      [],
      false,
    )
    expect(next).toEqual({})
  })

  it('truncated：只 upsert，不删缺项', () => {
    const prev: Record<string, BackgroundTaskInfo> = {
      keep: { taskId: 'keep', command: 'a', status: 'running' },
      upd: { taskId: 'upd', command: 'old', toolCallId: 'tc', status: 'running' },
    }
    const next = applyBackgroundTasksSnapshot(
      prev,
      [{ taskId: 'upd', command: 'new', status: 'failed', exitCode: 1 }],
      true,
    )
    expect(next.keep.command).toBe('a')
    expect(next.upd.command).toBe('new')
    expect(next.upd.status).toBe('failed')
    expect(next.upd.toolCallId).toBe('tc')
    expect(next.upd.exitCode).toBe(1)
  })
})

describe('upsertBackgroundTaskIncremental', () => {
  it('按 taskId 写入并挂 toolCallId；清掉旧 toolCallId key', () => {
    const prev: Record<string, BackgroundTaskInfo> = {
      'tc-old': { taskId: 't9', command: 'legacy', toolCallId: 'tc-old' },
    }
    const next = upsertBackgroundTaskIncremental(prev, 'tc-new', {
      taskId: 't9',
      command: 'npm test',
      outputFile: '/tmp/out',
      description: '测',
    })
    expect(next['tc-old']).toBeUndefined()
    expect(next['tc-new']).toBeUndefined()
    expect(next.t9.taskId).toBe('t9')
    expect(next.t9.toolCallId).toBe('tc-new')
    expect(next.t9.command).toBe('npm test')
    expect(next.t9.status).toBe('running')
  })
})

describe('findBackgroundTaskByToolCallId', () => {
  it('用 toolCallId 字段反查', () => {
    const tasks: Record<string, BackgroundTaskInfo> = {
      t1: { taskId: 't1', command: 'x', toolCallId: 'tc-1' },
    }
    expect(findBackgroundTaskByToolCallId(tasks, 'tc-1')?.taskId).toBe('t1')
    expect(findBackgroundTaskByToolCallId(tasks, 'missing')).toBeUndefined()
  })
})

describe('runningBackgroundTaskEntries', () => {
  it('过滤掉已结束的', () => {
    const tasks: Record<string, BackgroundTaskInfo> = {
      a: { taskId: 'a', command: '1', status: 'running' },
      b: { taskId: 'b', command: '2', status: 'completed' },
      c: { taskId: 'c', command: '3' },
    }
    expect(runningBackgroundTaskEntries(tasks).map(([k]) => k).sort()).toEqual([
      'a',
      'c',
    ])
  })
})

describe('backgroundToolCallIdSet', () => {
  it('只收集 toolCallId，不把 taskId 当 tool id', () => {
    const tasks: Record<string, BackgroundTaskInfo> = {
      t1: { taskId: 't1', command: 'x', toolCallId: 'tc-1' },
      t2: { taskId: 't2', command: 'y' },
    }
    expect([...backgroundToolCallIdSet(tasks)]).toEqual(['tc-1'])
  })
})
