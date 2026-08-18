import { atom } from 'nanostores'

/** 待打开的流程 id。画布尚未 mount 时也会保留，等待进入画布后消费。 */
export const $flowFocusId = atom<string | null>(null)

export function requestFlowFocus(id: string): void {
  const next = id.trim()
  $flowFocusId.set(next || null)
}

export function clearFlowFocus(id: string): void {
  if ($flowFocusId.get() === id) $flowFocusId.set(null)
}
