import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $sessionPhase,
  $tabs,
  findReadyCodingTabId,
  getTabState,
} from '../store'

/** 设置/能力面板：绑到已就绪的编码会话，不绑画布 Tab。 */
export function useCodingSessionTabId(): string {
  useStore($activeTabId)
  useStore($sessionPhase)
  useStore($tabs)
  return findReadyCodingTabId()
}

export function codingSessionReady(tabId: string): boolean {
  const st = getTabState(tabId)
  if (!st) return false
  return st.phase === 'ready' || Boolean(st.sessionId)
}
