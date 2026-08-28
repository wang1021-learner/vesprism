import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { ReadableAtom } from 'nanostores'

/**
 * 订 atom，但只在选中值按 isEqual 变化时重渲染。
 * 工具行用它订「这一条」后台任务 / 子任务，避免整表一变所有行都刷。
 */
export function useStoreSelect<T, S>(
  store: ReadableAtom<T>,
  select: (value: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const selectRef = useRef(select)
  selectRef.current = select
  const eqRef = useRef(isEqual)
  eqRef.current = isEqual
  const cache = useRef<S>(select(store.get()))

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(onChange),
    [store],
  )

  const getSnapshot = useCallback(() => {
    const next = selectRef.current(store.get())
    if (eqRef.current(cache.current, next)) return cache.current
    cache.current = next
    return next
  }, [store])

  return useSyncExternalStore(subscribe, getSnapshot)
}
