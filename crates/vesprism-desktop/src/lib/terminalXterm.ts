import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ptyDetach, ptyResize, ptyWrite, startPty, stopPty } from '../bridge'

export type PtyOutputEvent = { tab_id: string; data: string }

export function startTabPty(tabId: string, cwd: string, cols: number, rows: number) {
  return startPty(tabId, cwd, cols, rows)
}

export function writeTabPty(tabId: string, data: string) {
  return ptyWrite(tabId, data)
}

export function resizeTabPty(tabId: string, cols: number, rows: number) {
  return ptyResize(tabId, cols, rows)
}

export function detachTabPty(tabId: string) {
  return ptyDetach(tabId)
}

export function stopTabPty(tabId: string) {
  return stopPty(tabId)
}

export function listenPtyOutput(
  tabId: string,
  onData: (data: string) => void,
): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>('pty-output', (e) => {
    if (e.payload?.tab_id === tabId && typeof e.payload.data === 'string') {
      onData(e.payload.data)
    }
  })
}
