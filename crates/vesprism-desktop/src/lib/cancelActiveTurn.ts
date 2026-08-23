/**
 * 停掉当前生成轮：先拒绝挂起的写权限，再发官方 cancel，并立刻把 UI 置闲。
 * 权限卡在 Pending 时引擎可能不回 turn_ended，不能只等事件。
 */
import { cancelTurn, respondPermission } from '../bridge'
import { $activeTabId, getTabState, patchTab } from '../store'
import { pickDeny } from './permissionMemory'

export async function cancelActiveTurn(tabId = $activeTabId.get()): Promise<void> {
  if (!tabId) return
  const st = getTabState(tabId)
  const perm = st?.permission
  if (perm) {
    const deny = pickDeny(perm.options)
    const requestId = Number(perm.id)
    if (deny && !Number.isNaN(requestId)) {
      try {
        await respondPermission(tabId, requestId, deny.id)
      } catch {
        /* 回合可能已经没了 */
      }
    }
  }
  try {
    await cancelTurn(tabId)
  } catch (e) {
    patchTab(tabId, { error: String(e) })
  }
  const queued = getTabState(tabId)?.queuedPrompts ?? []
  patchTab(tabId, {
    status: queued.length > 0 ? 'generating' : 'idle',
    permission: null,
    userQuestion: null,
    mcpElicit: null,
  })
}
