import type { DramaProjectList } from '../../../drama-core/bindings/drama'
import { createProject, listProjects } from './api'
import { atom } from 'nanostores'

const LAST = 'vesprism.drama.lastProject'
/** 上次打开的编号只用来默认选中，不算数据来源。 */
export const lastProject = () => { try { return localStorage.getItem(LAST) } catch { return null } }
export const rememberProject = (id: string) => { try { localStorage.setItem(LAST, id) } catch { /* 忽略 */ } }

export const $projectList = atom<DramaProjectList | null>(null)
export async function refreshProjects() {
  const r = await listProjects()
  if (r?.ok) $projectList.set(r.value)
  return r
}
export async function newProject(name: string) {
  const r = await createProject(name.trim() || undefined)
  if (r.ok) await refreshProjects()
  return r
}
