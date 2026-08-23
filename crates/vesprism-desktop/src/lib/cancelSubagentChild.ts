/**
 * 只取消这一个子代理，不动父轮次里别的帮手。
 * 成功后先本地标成已取消，finished 事件再来也幂等。
 */
import { cancelSubagent } from '../bridge'
import {
  $activeTabId,
  getTabState,
  pushToast,
  untrackSubagentRunning,
  upsertSubagent,
} from '../store'

export async function cancelSubagentChild(subagentId: string): Promise<boolean> {
  const id = (subagentId || '').trim()
  const tabId = $activeTabId.get()
  if (!tabId || !id) return false
  try {
    await cancelSubagent(tabId, id)
    const parent =
      getTabState(tabId)?.subagents.find((s) => s.subagentId === id)
        ?.parentSessionId ?? ''
    upsertSubagent(tabId, { subagentId: id, status: 'cancelled' })
    untrackSubagentRunning(id, parent)
    return true
  } catch (e) {
    pushToast(`取消失败：${String(e)}`, 'error')
    return false
  }
}
