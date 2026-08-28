import { describe, expect, it } from 'vitest'
import { atom } from 'nanostores'
import { pickIfUnchanged } from './useStoreSelect'

describe('pickIfUnchanged', () => {
  it('其它键变了，选中项引用不变', () => {
    const $tasks = atom<Record<string, { id: string }>>({
      a: { id: 'a' },
    })
    const first = $tasks.get().a
    $tasks.set({ ...$tasks.get(), b: { id: 'b' } })
    const picked = pickIfUnchanged(first, $tasks.get().a)
    expect(picked).toBe(first)
  })

  it('选中项被替换则换新值', () => {
    const $tasks = atom<Record<string, { id: string }>>({
      a: { id: 'a' },
    })
    const first = $tasks.get().a
    $tasks.set({ a: { id: 'a2' } })
    const picked = pickIfUnchanged(first, $tasks.get().a)
    expect(picked).not.toBe(first)
    expect(picked?.id).toBe('a2')
  })
})
