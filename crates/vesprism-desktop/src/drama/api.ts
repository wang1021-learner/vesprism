// 漫剧联调接入层：命令名、事件名、类型只从 bindings 引用，不手写字符串。
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  DRAMA_COMMANDS, DRAMA_JOB_EVENT,
  type DramaCommandError, type DramaExportArgs, type DramaGraphView, type DramaLayoutArgs, type DramaProjectList, type DramaProjectSummary, type DramaLink,
  type DramaRetryArgs, type JobEvent, type DramaAddNodeArgs, type DramaAddNodeResult, type DramaRemoveNodeArgs,
} from '../../../drama-core/bindings/drama'

export type Result<T> = { ok: true; value: T } | { ok: false; error: DramaCommandError }

/** 只有「命令没注册 / 不在 Tauri 里」才算没后端；DramaCommandError 一律直接报错撤回，不退模拟。 */
export class NoBackend extends Error {}

function isCommandError(e: unknown): e is DramaCommandError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { ok: true, value: await invoke<T>(cmd, args) }
  } catch (e) {
    if (isCommandError(e)) return { ok: false, error: e }
    throw new NoBackend(String(e))
  }
}

/** 返回 null 表示没后端（开关关着），界面退回模拟数据并挂「模拟数据」角标。 */
export async function loadGraph(projectId: string): Promise<Result<DramaGraphView> | null> {
  try { return await call<DramaGraphView>(DRAMA_COMMANDS.loadGraph, { projectId }) } catch (e) {
    if (e instanceof NoBackend) return null
    throw e
  }
}

export const linkNodes = (projectId: string, link: DramaLink) => call<DramaGraphView>(DRAMA_COMMANDS.link, { projectId, link })
export const unlinkNodes = (projectId: string, link: DramaLink) => call<DramaGraphView>(DRAMA_COMMANDS.unlink, { projectId, link })
export const addNodeCmd = (a: DramaAddNodeArgs) => call<DramaAddNodeResult>(DRAMA_COMMANDS.addNode, { ...a })
export const removeNodeCmd = (a: DramaRemoveNodeArgs) => call<DramaGraphView>(DRAMA_COMMANDS.removeNode, { ...a })
export const saveLayout = (a: DramaLayoutArgs) => call<void>(DRAMA_COMMANDS.setLayout, { ...a })
export const setTextCmd = (projectId: string, nodeId: string, text: string) =>
  call<DramaGraphView>(DRAMA_COMMANDS.setText, { projectId, nodeId, text })
export const retryConfirmed = (a: DramaRetryArgs) => call<void>(DRAMA_COMMANDS.retryConfirmed, { ...a })
export const exportFinal = (a: DramaExportArgs) => call<void>(DRAMA_COMMANDS.exportFinal, { ...a })

export async function listProjects(): Promise<Result<DramaProjectList> | null> {
  try { return await call<DramaProjectList>(DRAMA_COMMANDS.listProjects, {}) } catch (e) { if (e instanceof NoBackend) return null; throw e }
}
export const createProject = (name?: string) => call<DramaProjectSummary>(DRAMA_COMMANDS.createProject, { name })
export const startJobCmd = (projectId: string, nodeId: string) => call<JobEvent>(DRAMA_COMMANDS.startJob, { projectId, nodeId })
export const listJobs = (projectId: string) => call<JobEvent[]>(DRAMA_COMMANDS.listJobs, { projectId })

export const onJob = (fn: (e: JobEvent) => void): Promise<UnlistenFn> => listen<JobEvent>(DRAMA_JOB_EVENT, ev => fn(ev.payload))

export const ERROR_TEXT: Record<DramaCommandError['code'], string> = {
  invalid_link: '有连线已失效，删掉后再导出',
  type_mismatch: '这两个端口类型不匹配，连不上',
  script_locked: '剧本已定稿，先解锁才能改',
  cycle: '这样连会形成循环，连不上',
  not_found: '找不到这个节点或项目',
  stale_not_confirmed: '部分素材不是最新，需先确认再导出',
  io: '读写项目文件出错',
}
