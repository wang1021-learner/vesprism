import { sendSessionPrompt } from './sendSessionPrompt'
import { openChatTab } from './openChatTab'
import { sessionRecap } from '../bridge'
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

/** 发官方斜杠但不进用户气泡（Goal / 工作流按钮、/memory 拉列表）。 */
export function sendEngineSlash(text: string, tabId?: string): Promise<string | null> {
  const cmd = text.trim()
  if (!cmd) return Promise.resolve(null)
  return sendSessionPrompt({ text: cmd, hidden: true, tabId })
}
