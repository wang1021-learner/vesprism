// 后端动作：模拟数据时只改本地；后端出错不改本地（即撤回），直接提示。
import type { DramaGraphView, DramaLink, NodeKind } from '../../../drama-core/bindings/drama'
import { ERROR_TEXT, addNodeCmd, exportFinal, retryConfirmed, saveLayout, setTextCmd, startJobCmd, unlinkNodes, type Result } from './api'
import { $dramaJobs, upsertJob } from './jobs'
import { newProject } from './projects'
import { openProject } from './shell'
import { invalidLinkMessage, markInvalid } from './palette'
import { $dramaError, $dramaFocusLinks, $dramaExpanded, $dramaLayout, $dramaLinks, $dramaNodes, $dramaProjectId, $dramaSource, setLayout } from './store'

const pid = () => ($dramaSource.get() === 'backend' ? $dramaProjectId.get() : null)
function report<T>(r: Result<T>): r is { ok: true; value: T } {
  if (r.ok) { $dramaError.set(null); return true }
  $dramaError.set(ERROR_TEXT[r.error.code] ?? r.error.message); return false
}
const apply = (g: DramaGraphView) => { $dramaNodes.set(g.nodes); $dramaLinks.set(g.links) }

function nextSpot(): { x: number; y: number } {
  const spots = Object.values($dramaLayout.get())
  if (spots.length === 0) return { x: 80, y: 80 }
  return { x: Math.max(...spots.map(p => p.x)) + 280, y: 80 }
}

/** 放到当前项目。没有打开的项目时先新建一集（空图会种上一组节点），不再额外加一个。 */
export async function placeNode(kind: NodeKind, at?: { x: number; y: number }): Promise<string | null> {
  if (!pid()) {
    try {
      const created = await newProject('')
      if (!created.ok) {
        $dramaError.set(ERROR_TEXT[created.error.code] ?? created.error.message)
        return null
      }
      await openProject(created.value.projectId)
    } catch {
      $dramaError.set('后端不可用')
    }
    return null
  }
  const projectId = pid()
  if (!projectId) return null
  const pos = at ?? nextSpot()
  const r = await addNodeCmd({ projectId, kind, position: { x: Math.round(pos.x), y: Math.round(pos.y) } })
  if (!report(r)) return null
  apply(r.value.graph)
  setLayout(r.value.nodeId, pos)
  return r.value.nodeId
}

export async function unlink(link: DramaLink) {
  const p = pid()
  if (!p) { $dramaLinks.set($dramaLinks.get().filter(l => !(l.from === link.from && l.to === link.to && l.port === link.port))); return }
  const { from, to, port, sourceItem } = link // 去掉整图里的 invalid 字段，只传合同里的 DramaLink
  const r = await unlinkNodes(p, sourceItem === undefined ? { from, to, port } : { from, to, port, sourceItem })
  if (report(r)) apply(r.value)
  else $dramaLinks.set([...$dramaLinks.get()]) // 触发重绘，把被删的线画回来
}

export async function setNodeText(nodeId: string, text: string) {
  const p = pid()
  if (!p) {
    $dramaNodes.set($dramaNodes.get().map(n => (n.id === nodeId ? { ...n, text } : n)))
    return
  }
  const r = await setTextCmd(p, nodeId, text)
  if (report(r)) apply(r.value)
}

export async function startJob(nodeId: string) {
  const p = pid()
  if (!p) { $dramaError.set('先打开一个漫剧项目，再生成图片'); return }
  const r = await startJobCmd(p, nodeId)
  if (report(r) && r.value?.jobId) $dramaJobs.set(upsertJob($dramaJobs.get(), r.value))
}

/** 拖完才存位置；只存布局，不触发生成。 */
export async function persistLayout(nodeId: string, pos: { x: number; y: number }) {
  const p = pid(); if (!p) return
  report(await saveLayout({ projectId: p, nodeId, x: pos.x, y: pos.y, collapsed: !$dramaExpanded.get()[nodeId] }))
}

export async function retryJob(jobId: string) {
  const p = pid(); if (!p) return
  report(await retryConfirmed({ projectId: p, jobId }))
}

export async function exportEpisode(staleConfirmed: boolean) {
  const p = pid(); if (!p) { $dramaError.set('模拟数据不能导出'); return }
  const node = $dramaNodes.get().find(n => n.kind === 'export')
  if (!node) { $dramaError.set(ERROR_TEXT.not_found); return }
  const r = await exportFinal({ projectId: p, exportNodeId: node.id, staleConfirmed })
  if (!r.ok && r.error.code === 'invalid_link') {
    // 失效连线必须先删：提示条数、高亮并定位第一条，不带 staleConfirmed 重试。
    const bad = r.error.links ?? []
    $dramaError.set(invalidLinkMessage(r.error) ?? ERROR_TEXT.invalid_link)
    if (bad.length) { $dramaLinks.set(markInvalid($dramaLinks.get(), bad)); $dramaFocusLinks.set({ links: bad, seq: Date.now() }) }
    return
  }
  report(r)
}
