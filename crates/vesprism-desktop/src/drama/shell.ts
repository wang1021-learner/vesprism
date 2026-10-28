// 漫剧壳的共享状态：侧栏和主区都从这里打开项目。
import { atom } from 'nanostores'
import type { NodeKind, PortType } from '../../../drama-core/bindings/drama'
import { $dramaError, $dramaExpanded, $dramaLayout, $dramaLinks, $dramaNodes, $dramaProjectId, $dramaSource } from './store'
import { ERROR_TEXT, addNodeCmd, linkNodes, listJobs, loadGraph, onJob, setTextCmd } from './api'
import { lastProject, refreshProjects, rememberProject } from './projects'
import { $dramaJobs, setJobs, upsertJob } from './jobs'
import { seedEditors } from './editorData'

export type DramaView = 'probe' | 'off' | 'list' | 'canvas'
export const $dramaView = atom<DramaView>('probe')

let started = false
let openSeq = 0
/** 同一项目的播种只跑一次；失败则删掉，下次打开再试。 */
const seeding = new Map<string, Promise<boolean>>()

const STARTER: { kind: NodeKind; x: number; y: number; text: string }[] = [
  { kind: 'script', x: 40, y: 40, text: '雨夜，巷口。少年站在灯下。' },
  { kind: 'character', x: 40, y: 420, text: '黑衣少年，短发，眼睛很亮。' },
  { kind: 'shot', x: 420, y: 140, text: '他回头看向巷子深处。' },
  { kind: 'voice', x: 420, y: 500, text: '低声：谁在后面。' },
  { kind: 'export', x: 820, y: 260, text: '' },
]

function fail(code: string, message: string) {
  $dramaError.set(ERROR_TEXT[code as keyof typeof ERROR_TEXT] ?? message)
}

/** 新建项目在后端是空图。打开时若一个节点都没有，种上一集已经连好的分镜。 */
function seedBoard(id: string): Promise<boolean> {
  const pending = seeding.get(id)
  if (pending) return pending
  const job = runSeed(id).then(ok => {
    if (!ok) seeding.delete(id)
    return ok
  })
  seeding.set(id, job)
  return job
}

async function runSeed(id: string): Promise<boolean> {
  const ids: Partial<Record<NodeKind, string>> = {}
  for (const step of STARTER) {
    const added = await addNodeCmd({ projectId: id, kind: step.kind, position: { x: step.x, y: step.y } })
    if (!added.ok) { fail(added.error.code, added.error.message); return false }
    ids[step.kind] = added.value.nodeId
    if (!step.text) continue
    const text = await setTextCmd(id, added.value.nodeId, step.text)
    if (!text.ok) { fail(text.error.code, text.error.message); return false }
  }
  const script = ids.script
  const character = ids.character
  const shot = ids.shot
  const voice = ids.voice
  const exp = ids.export
  if (!script || !character || !shot || !voice || !exp) return false
  const wires: { from: string; to: string; port: PortType }[] = [
    { from: script, to: shot, port: 'line' },
    { from: character, to: shot, port: 'character_look' },
    { from: script, to: voice, port: 'line' },
    { from: character, to: voice, port: 'character_look' },
    { from: voice, to: exp, port: 'audio' },
    { from: shot, to: exp, port: 'image' },
  ]
  for (const link of wires) {
    const linked = await linkNodes(id, link)
    if (!linked.ok) { fail(linked.error.code, linked.error.message); return false }
  }
  return true
}

/** 只探测一次后端；重复调用无副作用。有项目时直接打开最近一集。 */
export function initDrama() {
  if (started) return
  started = true
  seedEditors(60)
  void refreshProjects().then(async r => {
    if (r === null) { $dramaView.set('off'); return }
    if (!r.ok) {
      $dramaError.set(ERROR_TEXT[r.error.code] ?? r.error.message)
      if ($dramaView.get() === 'probe') $dramaView.set('list')
      return
    }
    if ($dramaView.get() !== 'probe') return
    const projects = r.value.projects
    if (projects.length === 0) { $dramaView.set('list'); return }
    const last = lastProject()
    const pick = projects.find(p => p.projectId === last) ?? projects[0]
    await openProject(pick.projectId)
    if ($dramaView.get() === 'probe') $dramaView.set('list')
  }).catch(() => $dramaView.set('off'))
  onJob(e => {
    $dramaJobs.set(upsertJob($dramaJobs.get(), e))
    if (e.status === 'done' || e.status === 'failed') void reloadOpenGraph()
  }).catch(() => null)
}

async function reloadOpenGraph() {
  const id = $dramaProjectId.get()
  if (!id || $dramaSource.get() !== 'backend') return
  const g = await loadGraph(id)
  if (!g?.ok) return
  $dramaNodes.set(g.value.nodes)
  $dramaLinks.set(g.value.links)
}

export async function openProject(id: string) {
  const seq = ++openSeq
  let g = await loadGraph(id)
  if (seq !== openSeq) return
  if (!g?.ok) { $dramaError.set(g ? (ERROR_TEXT[g.error.code] ?? g.error.message) : '后端不可用'); return }
  let seedFailed = false
  if (g.value.nodes.length === 0) {
    seedFailed = !(await seedBoard(id))
    if (seq !== openSeq) return
    const again = await loadGraph(id)
    if (seq !== openSeq) return
    if (!again?.ok) { $dramaError.set(again ? (ERROR_TEXT[again.error.code] ?? again.error.message) : '后端不可用'); return }
    g = again
  }
  rememberProject(id)
  $dramaProjectId.set(id); $dramaSource.set('backend')
  if (!seedFailed) $dramaError.set(null)
  $dramaNodes.set(g.value.nodes); $dramaLinks.set(g.value.links)
  const lay = g.value.layout ?? {}
  $dramaLayout.set(Object.fromEntries(g.value.nodes.map((n, i) => [n.id, lay[n.id] ? { x: lay[n.id].x, y: lay[n.id].y } : { x: (i % 8) * 220, y: Math.floor(i / 8) * 140 }])))
  $dramaExpanded.set(Object.fromEntries(Object.entries(lay).map(([k, l]) => [k, !l.collapsed])))
  const j = await listJobs(id)
  if (seq !== openSeq) return
  setJobs(j.ok ? j.value : [])
  $dramaView.set('canvas')
}
