/**
 * 手动重连：有历史会话 id 时优先 load_session（后端按 id 扫落盘 cwd）；
 * 否则关旧 actor、起空壳，后端会发 tab_recovering 再重放。
 */
import { loadSession, restartTab } from '../bridge'
import { formatEngineError } from './errorMessage'
import {
  abortOpenSession,
  beginAttachRuntime,
  finishAttachRuntime,
} from './sessionOpen'
import {
  cwdAfterLoadSession,
  getTabState,
  looksAbsolutePath,
  patchTab,
  resolveHistoryLoadCwd,
} from '../store'

export async function retryTabSession(tabId: string): Promise<void> {
  if (!tabId.trim()) return
  const st = getTabState(tabId)
  const sid = (st?.chatId || st?.sessionId || '').trim()
  patchTab(tabId, {
    phase: 'restarting',
    error: '',
    sessionAlert: null,
    permission: null,
    userQuestion: null,
    mcpElicit: null,
    status: 'idle',
  })
  if (sid) {
    const cwd = resolveHistoryLoadCwd(st?.cwd)
    if (looksAbsolutePath(cwd)) {
      beginAttachRuntime(tabId)
      try {
        const used = await loadSession(tabId, sid, cwd)
        finishAttachRuntime(tabId)
        patchTab(tabId, {
          sessionId: sid,
          chatId: sid,
          cwd: cwdAfterLoadSession(used, cwd),
          phase: 'ready',
          status: 'idle',
          error: '',
        })
        return
      } catch (e) {
        abortOpenSession(tabId)
        const msg = formatEngineError(e)
        patchTab(tabId, { phase: 'ready', error: msg, status: 'idle', cwd })
        return
      }
    }
  }
  try {
    await restartTab(tabId)
  } catch (e) {
    const msg = formatEngineError(e)
    patchTab(tabId, { phase: 'failed', error: msg, status: 'idle' })
  }
}
