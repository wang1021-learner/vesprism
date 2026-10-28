// 漫剧画布的纯逻辑：节点库、端口颜色、按端口筛选、项目排序。不依赖 React，便于测试。
import type { DramaLink, DramaLinkView } from '../../../drama-core/bindings/drama'
import { DRAMA_PORTS, type DramaAsset, type DramaCommandError, type DramaNode, type DramaProjectList, type NodeKind, type PortType } from '../../../drama-core/bindings/drama'

export const PORT_COLOR: Record<PortType, string> = {
  line: '#3d6b8c', character_look: '#8a4f6a', image: '#2f6f53', video: '#5c5378', audio: '#8a6508', final_cut: '#a32f2f',
}
export const PORT_LABEL: Record<PortType, string> = {
  line: '台词', character_look: '角色形象', image: '图像', video: '视频', audio: '音频', final_cut: '成片',
}
export const portColor = (p: string | null | undefined) => PORT_COLOR[p as PortType] ?? '#9ca3af'

/** 节点库条目。kind 为 null 表示后端还没有这种节点：只展示，不能添加。 */
export type LibItem = { key: string; label: string; kind: NodeKind | null; inputs: PortType[]; outputs: PortType[] }
const lib = (key: string, label: string, kind: NodeKind): LibItem => ({ key, label, kind, inputs: DRAMA_PORTS[kind].inputs, outputs: DRAMA_PORTS[kind].outputs })
/** 端口一律取 bindings 的 DRAMA_PORTS；剪辑后端还没有，端口仅作展示。 */
export const LIBRARY: LibItem[] = [
  lib('script', '剧本', 'script'),
  lib('character', '角色', 'character'),
  lib('shot_group', '分镜', 'shot_group'),
  lib('shot', '出图', 'shot'),
  lib('voice', '配音', 'voice'),
  { key: 'edit', label: '剪辑', kind: null, inputs: ['image', 'video', 'audio'], outputs: ['video'] },
  lib('export', '导出', 'export'),
]
export const KIND_LABEL: Record<NodeKind, string> = Object.fromEntries(
  LIBRARY.filter(i => i.kind).map(i => [i.kind, i.label]),
) as Record<NodeKind, string>

/** 从端口拖到空白处：from='source' 找能接这个输入的节点；from='target' 找能产出它的节点。 */
export function filterByPort(items: LibItem[], port: PortType | null, from: 'source' | 'target' | null): LibItem[] {
  if (!port || !from) return items
  return items.filter(i => (from === 'source' ? i.inputs : i.outputs).includes(port))
}
export function searchLibrary(items: LibItem[], q: string): LibItem[] {
  const s = q.trim().toLowerCase()
  return s ? items.filter(i => i.label.includes(s) || i.key.includes(s)) : items
}

/** 模拟模式新建本地节点：端口取 DRAMA_PORTS。 */
export function makeNode(item: LibItem, _existing: DramaNode[], id: string): DramaNode | null {
  if (!item.kind) return null
  const p = DRAMA_PORTS[item.kind]
  return { id, kind: item.kind, inputs: [...p.inputs], outputs: [...p.outputs], locked: false, needsUpdate: false, text: '' }
}

/** 命令错误转成中文提示；没有对应文案时用后端原话。 */
export function errorText(e: DramaCommandError, table: Partial<Record<DramaCommandError['code'], string>>): string {
  return table[e.code] ?? e.message
}
/** 按 mime 决定预览方式。 */
export function assetKind(a: DramaAsset | null | undefined): 'image' | 'audio' | 'video' | 'file' | null {
  if (!a) return null
  const m = a.mime.toLowerCase()
  return m.startsWith('image/') ? 'image' : m.startsWith('audio/') ? 'audio' : m.startsWith('video/') ? 'video' : 'file'
}
/** 分镜节点优先视频，其次图片；其他节点用 asset；分镜组不预览。 */
export function previewAsset(n: { kind: NodeKind } & Partial<{ image: DramaAsset | null; video: DramaAsset | null; asset: DramaAsset | null }>): DramaAsset | null {
  if (n.kind === 'shot_group') return null
  if (n.kind === 'shot') return n.video ?? n.image ?? null
  return n.asset ?? null
}
/** 多选删除的结果提示：单个失败给具体原因，多个只给数量。 */
export function deleteSummary(total: number, failed: { message: string }[]): string | null {
  if (failed.length === 0) return null
  return total === 1 ? failed[0].message : `有 ${failed.length} 个节点没删掉`
}

/** 列表按更新时间倒序；打不开的放最后。 */
export function sortProjects(list: DramaProjectList): DramaProjectList {
  return { projects: [...list.projects].sort((a, b) => b.updatedAt - a.updatedAt), broken: [...list.broken] }
}

// ---- 失效连线（invalid_link）----
/** 失效连线的红色：比任何端口色都亮，再配虚线，一眼能和正常连线区分。 */
export const INVALID_COLOR = '#ff2d2d'
export const INVALID_EDGE_TIP = '这条连线已失效，选中后按 Delete 删除'
export const linkKey = (l: { from: string; to: string; port: string }) => `${l.from}-${l.to}-${l.port}`
export const invalidLinksText = (n: number) => `有 ${n} 条连线已失效，删掉后再导出`
/** invalid_link 且带了 links 时给出带数量的提示；否则 null，由调用方用 ERROR_TEXT。 */
export function invalidLinkMessage(e: DramaCommandError): string | null {
  const n = e.links?.length ?? 0
  return e.code === 'invalid_link' && n > 0 ? invalidLinksText(n) : null
}
/** 取第一条失效连线：错误里的 links 没有 invalid 字段（全是失效的），整图里的看 invalid。 */
export function firstInvalid<T extends DramaLink & { invalid?: boolean }>(links: T[] | null | undefined): T | null {
  return links?.find(l => l.invalid !== false) ?? null
}
export function edgeStyle(l: { port: string; invalid: boolean }, strong: boolean) {
  return l.invalid
    ? { stroke: INVALID_COLOR, strokeWidth: strong ? 4 : 3, strokeDasharray: '7 4' }
    : { stroke: portColor(l.port), strokeWidth: strong ? 3.5 : 2 }
}
/** 把后端报的失效连线标到当前连线上（不存在的忽略）。 */
export function markInvalid(links: DramaLinkView[], bad: DramaLink[]): DramaLinkView[] {
  const keys = new Set(bad.map(linkKey))
  return links.map(l => (keys.has(linkKey(l)) && !l.invalid ? { ...l, invalid: true } : l))
}
/** 画布居中的点：两端节点左上角的中点，再往右下偏半张卡片。 */
export function focusPoint(a?: { x: number; y: number }, b?: { x: number; y: number }): { x: number; y: number } | null {
  const p = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : (a ?? b)
  return p ? { x: p.x + 110, y: p.y + 60 } : null
}
