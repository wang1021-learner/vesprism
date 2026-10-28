import type { DramaLinkView, DramaNode } from '../../../drama-core/bindings/drama'
import type { Pos } from './store'

const node = (id: string, kind: DramaNode['kind'], inputs: DramaNode['inputs'], outputs: DramaNode['outputs']): DramaNode =>
  ({ id, kind, inputs, outputs, locked: false, needsUpdate: false, text: '' })

/** 一集 shotCount 个镜头的模拟数据，测试用例要求 60。 */
export function mockEpisode(shotCount = 60): { nodes: DramaNode[]; links: DramaLinkView[]; layout: Record<string, Pos> } {
  const nodes: DramaNode[] = [
    node('script', 'script', [], ['line']),
    node('character', 'character', [], ['character_look']),
    node('shots', 'shot_group', ['line', 'character_look'], ['image', 'video']),
    node('voice', 'voice', ['line'], ['audio']),
    node('export', 'export', ['video', 'audio'], ['final_cut']),
  ]
  const links: DramaLinkView[] = [
    { from: 'script', to: 'shots', port: 'line', invalid: false },
    { from: 'character', to: 'shots', port: 'character_look', invalid: false },
    { from: 'script', to: 'voice', port: 'line', invalid: false },
    { from: 'shots', to: 'export', port: 'video', invalid: false },
    { from: 'voice', to: 'export', port: 'audio', invalid: false },
  ]
  const layout: Record<string, Pos> = {
    script: { x: 0, y: 0 }, character: { x: 0, y: 200 }, shots: { x: 320, y: 100 },
    voice: { x: 320, y: 360 }, export: { x: 640, y: 200 },
  }
  for (let i = 0; i < shotCount; i++) {
    const id = `shot-${i + 1}`
    nodes.push({ ...node(id, 'shot', ['line', 'character_look'], ['image', 'video']) })
    layout[id] = { x: 320 + (i % 10) * 180, y: 560 + Math.floor(i / 10) * 120 }
  }
  return { nodes, links, layout }
}
