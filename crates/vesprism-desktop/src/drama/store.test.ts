import { describe, expect, it, beforeEach } from 'vitest'
import { mockEpisode } from './mock'
import { $dramaLayout, $dramaLinks, $dramaNodes, canConnect, editorFor, exportHasStale, markDownstream, setLayout, withStale } from './store'

beforeEach(() => { const m = mockEpisode(60); $dramaNodes.set(m.nodes); $dramaLinks.set(m.links); $dramaLayout.set(m.layout) })

describe('drama store', () => {
  it('60 个镜头 + 5 个分组', () => { expect($dramaNodes.get()).toHaveLength(65) })
  it('端口类型不匹配预判为不可连', () => {
    const [script, , , voice, exp] = $dramaNodes.get()
    expect(canConnect(script, voice, 'line')).toBe(true)
    expect(canConnect(script, exp, 'line')).toBe(false)
  })
  it('改剧本只标下游', () => {
    markDownstream('character')
    const flag = Object.fromEntries($dramaNodes.get().map(n => [n.id, n.needsUpdate]))
    expect(flag.shots).toBe(true); expect(flag.export).toBe(false); expect(flag.voice).toBe(false); expect(flag.script).toBe(false)
  })
  it('间接下游现算 upstreamStale，导出提示', () => {
    markDownstream('script')
    const v = Object.fromEntries(withStale($dramaNodes.get(), $dramaLinks.get()).map(n => [n.id, n]))
    expect(v.voice.needsUpdate).toBe(true); expect(v.export.needsUpdate).toBe(false)
    expect(v.export.upstreamStale).toBe(true); expect(v.script.upstreamStale).toBe(false)
    expect(exportHasStale(Object.values(v))).toBe(true)
  })
  it('拖动只改布局，不标需更新', () => {
    setLayout('shots', { x: 9, y: 9 })
    expect($dramaLayout.get().shots).toEqual({ x: 9, y: 9 })
    expect($dramaNodes.get().some(n => n.needsUpdate)).toBe(false)
  })
  it('双击映射到四种编辑器', () => {
    expect(editorFor('script')).toBe('script'); expect(editorFor('shot')).toBe('storyboard')
    expect(editorFor('voice')).toBe('timeline'); expect(editorFor('character')).toBe('character')
  })
})
