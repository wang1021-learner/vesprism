import { describe, expect, it } from 'vitest'
import { createDemoDraft } from './graph'
import { applySnap, historyCap, saveHash, takeSnap, topologyHash } from './compileCache'

describe('compileCache', () => {
  it('移动节点不改 topologyHash，改 saveHash', () => {
    const a = createDemoDraft()
    const b = {
      ...a,
      nodes: a.nodes.map((n, i) =>
        i === 0 ? { ...n, position: { x: (n.position?.x ?? 0) + 40, y: n.position?.y ?? 0 } } : n,
      ),
    }
    expect(topologyHash(a)).toBe(topologyHash(b))
    expect(saveHash(a)).not.toBe(saveHash(b))
  })

  it('改 params 会改 topologyHash', () => {
    const a = createDemoDraft()
    const b = {
      ...a,
      nodes: a.nodes.map((n) =>
        n.type === 'agent' ? { ...n, params: { ...n.params, prompt: '新提示' } } : n,
      ),
    }
    expect(topologyHash(a)).not.toBe(topologyHash(b))
  })

  it('快照不含 dirty，apply 后标脏', () => {
    const a = { ...createDemoDraft(), dirty: false, published: true }
    const snap = takeSnap(a)
    expect('dirty' in snap).toBe(false)
    const next = applySnap(a, snap)
    expect(next.dirty).toBe(true)
    expect(next.id).toBe(a.id)
    expect(next.published).toBe(true)
  })

  it('大图缩短撤销栈', () => {
    expect(historyCap(10)).toBe(30)
    expect(historyCap(80)).toBe(16)
    expect(historyCap(200)).toBe(8)
  })
})
