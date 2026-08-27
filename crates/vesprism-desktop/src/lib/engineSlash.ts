import { sendSessionPrompt } from './sendSessionPrompt'
import { openChatTab } from './openChatTab'
import { sessionRecap, shareSession } from '../bridge'
import { formatEngineError } from './errorMessage'
import {
  $activeTabId,
  $chatFindIndex,
  $chatFindOpen,
  $chatFindQuery,
  $sessionInsightOpen,
  $sessionScheduleOpen,
  findNormalChatTab,
  getTabState,
  patchTab,
  pushToast,
  switchTab,
} from '../store'

export function openSessionInsight(): void {
  $sessionScheduleOpen.set(false)
  $sessionInsightOpen.set(true)
}

export function closeSessionInsight(): void {
  $sessionInsightOpen.set(false)
}

/** 定时任务必须落在当前对话会话，不能另开专用面板会话。 */
export function openSessionSchedule(): void {
  $sessionInsightOpen.set(false)
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : null
  if (st?.utilityKind) {
    const chat = findNormalChatTab(false)
    if (chat) {
      switchTab(chat)
      $sessionScheduleOpen.set(true)
      return
    }
    void openChatTab({}).then((id) => {
      if (id) $sessionScheduleOpen.set(true)
    })
    return
  }
  $sessionScheduleOpen.set(true)
}

export function closeSessionSchedule(): void {
  $sessionScheduleOpen.set(false)
}

export function openChatFind(query?: string): void {
  $sessionInsightOpen.set(false)
  $sessionScheduleOpen.set(false)
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : null
  if (st?.utilityKind) {
    const chat = findNormalChatTab(false)
    if (chat) switchTab(chat)
  }
  if (query != null) $chatFindQuery.set(query)
  $chatFindIndex.set(-1)
  $chatFindOpen.set(true)
}

export function closeChatFind(): void {
  $chatFindOpen.set(false)
}

export async function requestRecap(): Promise<void> {
  let tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : null
  if (st?.utilityKind) {
    const chat = findNormalChatTab(false)
    if (!chat) {
      pushToast('先打开一个对话再回顾', 'info')
      return
    }
    switchTab(chat)
    tabId = chat
  }
  if (!tabId) return
  try {
    const r = await sessionRecap(tabId, false)
    if (r && r.disabled) {
      pushToast('回顾未开启', 'info')
      return
    }
    pushToast('正在写回顾…', 'info')
  } catch (e) {
    pushToast(String(e), 'error')
  }
}

export function dismissRecap(tabId?: string): void {
  const id = tabId || $activeTabId.get()
  if (id) patchTab(id, { lastRecap: null })
}

/** 发官方斜杠但不进用户气泡（Goal / 工作流按钮、/memory 拉列表）。失败抛错，不吞。 */
export async function sendEngineSlash(text: string, tabId?: string): Promise<string> {
  const cmd = text.trim()
  if (!cmd) throw new Error('命令为空')
  const id = await sendSessionPrompt({ text: cmd, hidden: true, tabId })
  if (!id) throw new Error('命令没发出去')
  return id
}

/** 斜杠发出去后给一句回执；引擎原文失败走 Toast。 */
export async function sendEngineSlashToast(cmd: string, ok: string, tabId?: string): Promise<void> {
  try {
    await sendEngineSlash(cmd, tabId)
    pushToast(ok, 'success')
  } catch (e) {
    pushToast(formatEngineError(e), 'error')
  }
}

/** 官方分享：把链接复制到剪贴板。账号未开通时引擎会拒绝。 */
export async function shareCurrentSession(): Promise<void> {
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : null
  if (st?.utilityKind) {
    const chat = findNormalChatTab(false)
    if (chat) {
      switchTab(chat)
    } else {
      pushToast('先打开一场对话再分享', 'info')
      return
    }
  }
  const id = $activeTabId.get()
  if (!id) {
    pushToast('先打开一场对话再分享', 'info')
    return
  }
  try {
    const r = await shareSession(id)
    const url = String(r.shareUrl ?? r.share_url ?? '').trim()
    if (!url) throw new Error('没有返回分享链接')
    try {
      await navigator.clipboard.writeText(url)
      pushToast('分享链接已复制', 'success')
    } catch {
      pushToast(`分享链接：${url}`, 'success')
    }
  } catch (e) {
    pushToast(formatEngineError(e), 'error')
  }
}
