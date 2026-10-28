import { describe, expect, it } from 'vitest'
import { $dramaJobs } from './jobs'
import { $dramaNodes, setLayout } from './store'
describe('拖动节点', () => {
  it('只改位置，不触发生成、不标需更新', () => {
    const jobs = { j1: { jobId: 'j1', nodeId: 'n1', status: 'running' as const, progress: 0.5, costUsd: null, errorCode: null, error: null } }
    $dramaJobs.set(jobs)
    const nodes = $dramaNodes.get()
    setLayout('n1', { x: 100, y: 200 })
    expect($dramaJobs.get()).toBe(jobs)
    expect($dramaNodes.get()).toBe(nodes)
  })
})
