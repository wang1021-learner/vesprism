/**
 * 手动重连：关旧 actor、起空壳。后端会发 tab_recovering，再由 sessionEvents 重放。
 */
import { restartTab } from '../bridge'
import { formatEngineError } from './errorMessage'
import { patchTab } from '../store'

export async function retryTabSession(tabId: string): Promise<void> {
  if (!tabId.trim()) return
  patchTab(tabId, {
    phase: 'restarting',
    error: '',
    sessionAlert: null,
    permission: null,
    userQuestion: null,
    mcpElicit: null,
    status: 'idle',
  })
  try {
    await restartTab(tabId)
  } catch (e) {
    const msg = formatEngineError(e)
    patchTab(tabId, { phase: 'failed', error: msg, status: 'idle' })
  }
}
