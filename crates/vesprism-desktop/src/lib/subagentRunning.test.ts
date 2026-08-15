/**
 * 运行中子代理聚合（侧栏徽标）——幂等计数单测：
 * spawn/finished 事件与启动对账可能重复到达，计数必须只加/只减一次。
 */
import { describe, expect, it } from 'vitest'
import { $runningByParent, trackSubagentRunning, untrackSubagentRunning } from '../store'

// 每个用例用唯一 id，避开模块级 tracked 集合的跨用例状态。
let seq = 0
const nextId = (tag: string) => `${tag}-${++seq}`

describe('运行中子代理聚合', () => {
  it('track 幂等：同一子代理只计一次', () => {
    const id = nextId('t')
    $runningByParent.set({})
    expect(trackSubagentRunning(id, 'p-1')).toBe(true)
    expect(trackSubagentRunning(id, 'p-1')).toBe(false)
    expect($runningByParent.get()['p-1']).toBe(1)
  })

  it('untrack 幂等：重复结束不再减', () => {
    const id = nextId('t')
    $runningByParent.set({})
    trackSubagentRunning(id, 'p-1')
    expect(untrackSubagentRunning(id, 'p-1')).toBe(true)
    expect(untrackSubagentRunning(id, 'p-1')).toBe(false)
    expect($runningByParent.get()['p-1']).toBe(0)
  })

  it('finished 事件不带父会话 id：用 fallback 也能正确减到对应父会话', () => {
    const id = nextId('t')
    $runningByParent.set({})
    trackSubagentRunning(id, 'p-2')
    expect(untrackSubagentRunning(id, '')).toBe(true)
    expect($runningByParent.get()['p-2']).toBe(0)
    // fallback 不会误减其它父会话
    expect($runningByParent.get()[''] ?? 0).toBe(0)
  })

  it('多个父会话独立计数', () => {
    const a = nextId('t')
    const b = nextId('t')
    $runningByParent.set({})
    trackSubagentRunning(a, 'p-a')
    trackSubagentRunning(b, 'p-b')
    expect($runningByParent.get()).toEqual({ 'p-a': 1, 'p-b': 1 })
    untrackSubagentRunning(a, 'p-a')
    expect($runningByParent.get()['p-a']).toBe(0)
    expect($runningByParent.get()['p-b']).toBe(1)
  })

  it('空 id 不计数', () => {
    $runningByParent.set({})
    expect(trackSubagentRunning('', 'p-x')).toBe(false)
    expect($runningByParent.get()).toEqual({})
  })
})
