import { describe, expect, it } from 'vitest'
import { LIBRARY, PORT_COLOR, assetKind, deleteSummary, errorText, filterByPort, previewAsset, makeNode, portColor, searchLibrary, sortProjects } from './palette'

describe('drama palette', () => {
  it('错误文案映射', () => {
    expect(errorText({ code: 'script_locked', message: 'x' }, { script_locked: '剧本已定稿，先解锁才能改' })).toBe('剧本已定稿，先解锁才能改')
    expect(errorText({ code: 'io', message: '原话' }, {})).toBe('原话')
  })
  it('素材按 mime 预览，shot 优先视频', () => {
    const img = { path: 'C:/a.png', mime: 'image/png' }, vid = { path: 'C:/a.mp4', mime: 'video/mp4' }, wav = { path: 'C:/a.wav', mime: 'audio/wav' }
    expect(assetKind(null)).toBeNull()
    expect(assetKind(wav)).toBe('audio')
    expect(previewAsset({ kind: 'shot', image: img, video: vid })).toBe(vid)
    expect(previewAsset({ kind: 'shot', image: img, video: null })).toBe(img)
    expect(previewAsset({ kind: 'shot', image: null, video: null })).toBeNull()
    expect(previewAsset({ kind: 'voice', asset: wav })).toBe(wav)
    expect(previewAsset({ kind: 'shot_group', asset: img })).toBeNull()
  })
  it('多选删除提示', () => {
    expect(deleteSummary(2, [])).toBeNull()
    expect(deleteSummary(1, [{ message: '剧本已定稿，先解锁才能改' }])).toBe('剧本已定稿，先解锁才能改')
    expect(deleteSummary(3, [{ message: 'a' }, { message: 'b' }])).toBe('有 2 个节点没删掉')
  })
  it('项目按更新时间倒序，坏库保留在 broken（最后显示）', () => {
    const r = sortProjects({ projects: [{ projectId: 'a', name: 'A', updatedAt: 1 }, { projectId: 'b', name: 'B', updatedAt: 3 }, { projectId: 'c', name: 'C', updatedAt: 2 }], broken: [{ projectId: 'x', message: 'bad' }] })
    expect(r.projects.map(p => p.projectId)).toEqual(['b', 'c', 'a'])
    expect(r.broken.map(p => p.projectId)).toEqual(['x'])
  })
  it('按端口类型筛选', () => {
    expect(filterByPort(LIBRARY, 'line', 'source').map(i => i.key)).toEqual(['shot_group', 'shot', 'voice'])
    expect(filterByPort(LIBRARY, 'video', 'target').map(i => i.key)).toEqual(['shot', 'edit'])
    expect(filterByPort(LIBRARY, null, null)).toHaveLength(LIBRARY.length)
  })
  it('搜索与颜色', () => {
    expect(searchLibrary(LIBRARY, '配音').map(i => i.key)).toEqual(['voice'])
    expect(portColor('image')).toBe(PORT_COLOR.image)
    expect(portColor('nope')).toBe('#9ca3af')
    expect(new Set(Object.values(PORT_COLOR)).size).toBe(Object.keys(PORT_COLOR).length)
  })
  it('没有后端类型的条目不能建节点', () => {
    expect(makeNode(LIBRARY.find(i => i.key === 'edit')!, [], 'n1')).toBeNull()
    const n = makeNode(LIBRARY[0], [], 'n1')!
    expect(n).toMatchObject({ id: 'n1', kind: 'script', outputs: ['line'] })
  })
})

import { INVALID_COLOR, edgeStyle, firstInvalid, focusPoint, invalidLinkMessage, linkKey, markInvalid } from './palette'

describe('drama invalid links', () => {
  const a = { from: 'script', to: 'voice', port: 'line' as const }
  const b = { from: 'voice', to: 'export', port: 'audio' as const }
  it('提示里的 N 取 error.links 的条数', () => {
    expect(invalidLinkMessage({ code: 'invalid_link', message: 'x', links: [a, b] })).toBe('有 2 条连线已失效，删掉后再导出')
    expect(invalidLinkMessage({ code: 'invalid_link', message: 'x' })).toBeNull()
    expect(invalidLinkMessage({ code: 'io', message: 'x', links: [a] })).toBeNull()
  })
  it('取第一条失效连线', () => {
    expect(firstInvalid([a, b])).toBe(a)
    expect(firstInvalid([{ ...a, invalid: false }, { ...b, invalid: true }])?.to).toBe('export')
    expect(firstInvalid([{ ...a, invalid: false }])).toBeNull()
    expect(firstInvalid(undefined)).toBeNull()
  })
  it('失效连线用红色虚线，且红色不与任何端口色相同', () => {
    const bad = edgeStyle({ port: 'line', invalid: true }, false)
    expect(bad.stroke).toBe(INVALID_COLOR)
    expect(bad).toHaveProperty('strokeDasharray')
    expect(Object.values(PORT_COLOR)).not.toContain(INVALID_COLOR)
    const ok = edgeStyle({ port: 'line', invalid: false }, false)
    expect(ok.stroke).toBe(PORT_COLOR.line)
    expect(ok).not.toHaveProperty('strokeDasharray')
    expect(edgeStyle({ port: 'line', invalid: true }, true).strokeWidth).toBeGreaterThan(bad.strokeWidth)
  })
  it('按 from/to/port 标记失效，其余不动', () => {
    const r = markInvalid([{ ...a, invalid: false }, { ...b, invalid: false }], [b])
    expect(r.map(l => l.invalid)).toEqual([false, true])
    expect(linkKey(a)).toBe('script-voice-line')
  })
  it('居中点', () => {
    expect(focusPoint({ x: 0, y: 0 }, { x: 200, y: 100 })).toEqual({ x: 210, y: 110 })
    expect(focusPoint(undefined, undefined)).toBeNull()
  })
})
