/**
 * 重试最新助手回复：conversation_only 回滚到该轮提问，再原话重发。
 * 不恢复文件快照，避免和「回滚」整包语义混用。
 *
 * 官方 rewind force=false 是预演（success 恒为 false），重试必须 force=true。
 */
import { executeRewind, loadSession, type PromptAttach } from '../bridge'
import {
  $activeTabId,
  getTabState,
  patchTab,
  pushToast,
} from '../store'
import { formatEngineError } from './errorMessage'
import { beginAttachRuntime, finishAttachRuntime } from './sessionOpen'
import { sendSessionPrompt } from './sendSessionPrompt'
import { originUserMessage, promptIndexForUserId } from './userMessage'

export async function retryAssistantTurn(assistantId: string): Promise<void> {
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : undefined
  if (!tabId || !st) {
    pushToast('没有可重试的会话', 'error')
    return
  }
  if (st.status === 'generating') {
    pushToast('请先停止当前生成', 'error')
    return
  }
  const origin = originUserMessage(st.messages, assistantId)
  const promptIndex = origin ? promptIndexForUserId(st.messages, origin.id) : null
  const text = (origin?.text || '').trim()
  const attachments: PromptAttach[] = (origin?.attachments ?? [])
    .filter((a) => a.path.trim())
    .map((a) => ({
      kind: a.kind,
      path: a.path,
      previewUrl: a.previewUrl,
    }))
  if (!origin || promptIndex == null || (!text && attachments.length === 0)) {
    pushToast('找不到对应提问，无法重试', 'error')
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
          ? '重试有文件冲突，请用回滚并勾选强制'
          : formatEngineError(resp.error || '重试失败'),
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

    const originIdx = getTabState(tabId)?.messages.findIndex((m) => m.id === origin.id) ?? -1
    if (originIdx >= 0) {
      patchTab(tabId, {
        messages: (getTabState(tabId)?.messages ?? []).slice(0, originIdx + 1),
        phase: 'ready',
        status: 'idle',
        error: '',
      })
    } else {
      patchTab(tabId, { phase: 'ready', status: 'idle', error: '' })
    }

    const sent = await sendSessionPrompt({
      text,
      attachments: attachments.length ? attachments : undefined,
      hidden: true,
    })
    if (!sent) {
      pushToast('已回到该提问，但重新发送失败', 'error')
    }
  } catch (e) {
    pushToast(formatEngineError(e), 'error')
  }
}
