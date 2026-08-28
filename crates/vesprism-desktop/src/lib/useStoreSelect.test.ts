import { describe, expect, it } from 'vitest'
import { atom } from 'nanostores'

/**
 * 与 useStoreSelect 相同的选取规则：源变了但选中值 Object.is 相同则保持旧引用。
 * hook 本身依赖 React，这里测规则，避免在 node 环境挂 DOM。
 */
function pickIfChanged<T, S>(
  prevSelected: S,
  source: T,
  select: (v: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const next = select(source)
  return isEqual(prevSelected, next) ? prevSelected : next
}

describe('useStoreSelect 选取规则', () => {
  it('其它键变了，选中项引用不变', () => {
    const $tasks = atom<Record<string, { id: string }>>({
      a: { id: 'a' },
    })
    const first = $tasks.get().a
    $tasks.set({ ...$tasks.get(), b: { id: 'b' } })
    const picked = pickIfChanged(first, $tasks.get(), (m) => m.a)
    expect(picked).toBe(first)
  })

  it('选中项被替换则换新值', () => {
    const $tasks = atom<Record<string, { id: string }>>({
      a: { id: 'a' },
    })
    const first = $tasks.get().a
    $tasks.set({ a: { id: 'a2' } })
    const picked = pickIfChanged(first, $tasks.get(), (m) => m.a)
    expect(picked).not.toBe(first)
    expect(picked?.id).toBe('a2')
  })
})
