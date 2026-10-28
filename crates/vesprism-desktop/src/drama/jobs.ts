// 任务状态：进画布先拉一次 drama_list_jobs，之后按 drama://job 推送合并；同号重试覆盖原卡片。
import { atom } from 'nanostores'
import type { JobEvent } from '../../../drama-core/bindings/drama'

export const $dramaJobs = atom<Record<string, JobEvent>>({})

export function upsertJob(map: Record<string, JobEvent>, e: JobEvent): Record<string, JobEvent> {
  return { ...map, [e.jobId]: e }
}
export function setJobs(list: JobEvent[]) {
  $dramaJobs.set(list.reduce(upsertJob, {}))
}
