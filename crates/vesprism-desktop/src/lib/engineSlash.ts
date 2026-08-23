import { sendSessionPrompt } from './sendSessionPrompt'
import { openChatTab } from './openChatTab'
import {
  $activeTabId,
  $sessionInsightOpen,
  $sessionScheduleOpen,
  findNormalChatTab,
  getTabState,
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

/** 发官方斜杠但不进用户气泡（Goal / 工作流按钮、/memory 拉列表）。 */
export function sendEngineSlash(text: string): Promise<string | null> {
  const cmd = text.trim()
  if (!cmd) return Promise.resolve(null)
  return sendSessionPrompt({ text: cmd, hidden: true })
}
