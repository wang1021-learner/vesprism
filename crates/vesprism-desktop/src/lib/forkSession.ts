/**
 * 派生当前会话（官方 x.ai/session/fork）→ 新 tab 打开副本继续聊。
 * fork 复制整个会话到新 session id（引擎落盘），新 tab 走标准 attach 流程恢复。
 */
import {
  $activeTabId,
  createTab,
  getTabState,
  patchTab,
  pushToast,
  resolveNewTabModel,
  resolveWorkspaceCwd,
  switchTab,
} from '../store'
import { forkSession, getSessionMessages, loadSession, openTab } from '../bridge'
import {
  beginAttachRuntime,
  cacheSessionMessages,
  currentLoadGen,
  finishAttachRuntime,
  hydrateFromSnapshot,
  nextLoadGen,
} from './sessionOpen'
import { mapDisplayMessages } from './openSubagentTab'

export async function forkCurrentSession(): Promise<void> {
  const tabId = $activeTabId.get()
  const st = getTabState(tabId)
  const cwd = (st?.cwd || resolveWorkspaceCwd() || '').trim()
  if (!st?.sessionId || !cwd) {
    pushToast('当前会话尚未就绪，无法派生', 'error')
    return
  }
  const parentTitle = st.chatTitle?.trim() || '派生会话'
  try {
    const newId = await forkSession(tabId, cwd)
    const model = resolveNewTabModel(tabId)
    const newTabId = await openTab()
    createTab(newTabId, {
      cwd,
      chatTitle: parentTitle,
      chatId: newId,
      modelId: model.modelId,
      reasoningEffort: model.reasoningEffort,
      phase: 'loading',
      status: 'initializing',
    })
    switchTab(newTabId)
    // 加载代际保护：attach 过程中用户切换/重开时放弃迟到写入（对齐 openSubagentTab）
    const gen = nextLoadGen(newTabId)

    // 磁盘投影（fork 后历史已落盘）→ attach 恢复
    try {
      const raw = await getSessionMessages(newId)
      if (gen !== currentLoadGen(newTabId)) return
      const messages = mapDisplayMessages(raw)
      if (messages.length) {
        cacheSessionMessages(newId, messages)
        hydrateFromSnapshot(messages, newTabId)
      }
    } catch {
      /* 空历史稍后由 attach 事件填充 */
    }

    beginAttachRuntime(newTabId)
    await loadSession(newTabId, newId, cwd)
    if (gen !== currentLoadGen(newTabId)) return
    finishAttachRuntime(newTabId)
    patchTab(newTabId, {
      sessionId: newId,
      chatId: newId,
      phase: 'ready',
      status: 'idle',
      error: '',
    })
    pushToast('已派生新会话', 'success')
  } catch (e) {
    pushToast(`派生失败：${String(e)}`, 'error')
  }
}
