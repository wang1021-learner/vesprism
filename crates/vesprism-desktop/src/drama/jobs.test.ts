import { describe, expect, it } from 'vitest'
import { $dramaJobs, setJobs, upsertJob } from './jobs'
const ev = (jobId: string, status: 'queued' | 'running' | 'done' | 'failed') =>
  ({ jobId, nodeId: 'n1', status, progress: 0, costUsd: null, errorCode: null, error: null })
describe('jobs', () => {
  it('推送按编号覆盖，同号重试回到排队', () => {
    let m = upsertJob({}, ev('j1', 'running'))
    m = upsertJob(m, ev('j1', 'failed'))
    m = upsertJob(m, ev('j1', 'queued'))
    expect(Object.keys(m)).toEqual(['j1'])
    expect(m.j1.status).toBe('queued')
  })
  it('拉取结果整体替换旧状态', () => {
    $dramaJobs.set({ old: ev('old', 'running') })
    setJobs([ev('j2', 'done')])
    expect(Object.keys($dramaJobs.get())).toEqual(['j2'])
  })
})
