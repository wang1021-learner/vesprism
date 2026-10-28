// 漫剧独立 store，不写 tabStates。
import { atom } from 'nanostores'
import { dramaCanLink, type DramaLinkView, type DramaAsset, type DramaLink, type DramaNode, type DramaNodeView, type LinkError, type PortType } from '../../../drama-core/bindings/drama'

export type Pos = { x: number; y: number }
export type EditorKind = 'script' | 'storyboard' | 'timeline' | 'character'
export type EditorMode = 'side' | 'full'

export const $dramaNodes = atom<DramaNode[]>([])
export const $dramaLinks = atom<DramaLinkView[]>([])
/** 导出被 invalid_link 拒绝后要高亮并居中的连线；seq 变了才触发一次定位。 */
export const $dramaFocusLinks = atom<{ links: DramaLink[]; seq: number } | null>(null)
export const $dramaLayout = atom<Record<string, Pos>>({})
export const $dramaExpanded = atom<Record<string, boolean>>({})
export const $dramaEditor = atom<{ nodeId: string; kind: EditorKind; mode: EditorMode } | null>(null)
export const $dramaLinkError = atom<LinkError | null>(null)
export const $dramaError = atom<string | null>(null)
/** 'mock' 时画布右上角挂「模拟数据」角标。 */
export const $dramaSource = atom<'mock' | 'backend'>('mock')
export const $dramaProjectId = atom<string | null>(null)

/** 前端即时预判，最终以后端 link 结果为准。 */
export function canConnect(from: DramaNode, to: DramaNode, port: PortType): boolean {
  return dramaCanLink(from.kind, to.kind, port) && !to.locked
}

/** 只标直接下游（与后端规则一致）；模拟层用，真接口由后端返回。 */
export function markDownstream(startId: string): void {
  const hit = new Set($dramaLinks.get().filter(l => l.from === startId).map(l => l.to))
  $dramaNodes.set($dramaNodes.get().map(n => (hit.has(n.id) ? { ...n, needsUpdate: true } : n)))
}

/** 模拟后端现算的 upstreamStale：往上任一级有「需更新」即 true。接真接口后改读后端 DramaNodeView。 */
export function withStale(nodes: DramaNode[], links: DramaLink[]): DramaNodeView[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const memo = new Map<string, boolean>()
  const stale = (id: string, seen: Set<string>): boolean => {
    if (memo.has(id)) return memo.get(id)!
    if (seen.has(id)) return false
    seen.add(id)
    const v = links.filter(l => l.to === id).some(l => byId.get(l.from)?.needsUpdate || stale(l.from, seen))
    memo.set(id, v); return v
  }
  return nodes.map((n): DramaNodeView => {
    const v = n as Partial<Record<'image' | 'video' | 'asset', DramaAsset | null>>
    const upstreamStale = stale(n.id, new Set())
    return n.kind === 'shot'
      ? { ...n, kind: 'shot', image: v.image ?? null, video: v.video ?? null, upstreamStale }
      : { ...n, kind: n.kind as Exclude<DramaNode['kind'], 'shot'>, asset: v.asset ?? null, upstreamStale }
  })
}

/** 导出前提示：导出节点带任一角标即「部分素材不是最新」。 */
export function exportHasStale(nodes: DramaNodeView[]): boolean {
  const e = nodes.find(n => n.kind === 'export')
  return !!e && (e.needsUpdate || e.upstreamStale)
}

export function setLayout(id: string, pos: Pos): void {
  $dramaLayout.set({ ...$dramaLayout.get(), [id]: pos })
}

export function editorFor(kind: DramaNode['kind']): EditorKind | null {
  if (kind === 'script') return 'script'
  if (kind === 'shot_group' || kind === 'shot') return 'storyboard'
  if (kind === 'voice' || kind === 'export') return 'timeline'
  if (kind === 'character') return 'character'
  return null
}
