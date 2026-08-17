import { atom } from 'nanostores'

/** 待打开的编制 id。成功载入前一直留着，面板没 mount 也能等到打开。 */
export const $agentsFocusId = atom<string | null>(null)

export function requestAgentsFocus(id: string): void {
  const next = id.trim()
  $agentsFocusId.set(next || null)
}

export function clearAgentsFocus(id: string): void {
  if ($agentsFocusId.get() === id) $agentsFocusId.set(null)
}
