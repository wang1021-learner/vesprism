/**
 * 撤回最新用户提问：conversation_only 回滚到该提问之前，原文填回输入框，不重发。
 * 不恢复文件快照，避免和「回滚」整包语义混用。
 */
import { executeRewind, loadSession } from '../bridge'
import {
  $activeTabId,
  getTabState,
  patchTab,
  pushToast,
} from '../store'
import { beginAttachRuntime, finishAttachRuntime } from './sessionOpen'
import { canRecallUser, promptIndexForUserId } from './userMessage'

export async function recallUserTurn(userId: string): Promise<void> {
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : undefined
  if (!tabId || !st) {
    pushToast('没有可撤回的会话', 'error')
    return
  }
  if (st.status === 'generating') {
    pushToast('请先停止当前生成', 'error')
    return
  }
  if (!canRecallUser(st.messages, userId, false)) {
    pushToast('仅最新提问可撤回', 'error')
    return
  }
  const promptIndex = promptIndexForUserId(st.messages, userId)
  const origin = st.messages.find((m) => m.id === userId)
  const text = origin?.text || ''
  if (promptIndex == null || !text.trim()) {
    pushToast('找不到对应提问，无法撤回', 'error')
    return
  }
  if (!st.sessionId || !st.cwd) {
    pushToast('会话还没就绪', 'error')
    return
  }

  try {
    const resp = await executeRewind(tabId, promptIndex, 'conversation_only', true)
    if (!resp.success) {
      pushToast(
        resp.conflicts?.length
          ? '撤回有文件冲突，请用回滚并勾选强制'
          : resp.error || '撤回失败',
        'error',
      )
      return
    }

    beginAttachRuntime(tabId)
    try {
      await loadSession(tabId, st.sessionId, st.cwd, false, st.reasoningEffort)
    } finally {
      finishAttachRuntime(tabId)
    }
    patchTab(tabId, {
      phase: 'ready',
      status: 'idle',
      error: '',
      composerInput: text,
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('vesprism:set-composer-input', { detail: { text } }),
      )
    }
    pushToast('已撤回，原文已填回输入框', 'success')
  } catch (e) {
    pushToast(String(e), 'error')
  }
}
