/**
 * 关闭会话 Tab。
 *
 * 点击路径只做同步 UI：关最后一个空白「新对话」是空操作；
 * 最后一个有内容的 tab 原地清空；其余先从列表拿掉再后台 close_tab。
 * 绝不要在点击回调里 await closeTab / openChatTab / startSession。
 */
import {
  $activeTabId,
  $tabs,
  getTabState,
  hasTab,
  isBlankNewChat,
  patchTab,
  removeTab,
  resetTabToNewChat,
  resolveWorkspaceCwd,
  switchTab,
} from '../store'
import { closeTab, restartSession, startSession } from '../bridge'

/** @returns 是否发生了可见的关闭/重置（最后一个空白新对话返回 false） */
export function closeChatTab(id: string): boolean {
  const list = $tabs.get()
  const idx = list.findIndex((t) => t.id === id)
  if (idx < 0) return false

  const st = getTabState(id)
  const isLast = list.length <= 1
  const blank = !st || isBlankNewChat(st)

  // 关掉也只会立刻再建一个同样的空白对话，不必拆 actor + startSession
  if (isLast && blank) return false

  const wasActive = id === $activeTabId.get()

  if (isLast) {
    const cwd = resolveWorkspaceCwd()
    resetTabToNewChat(id, cwd)
    void refreshLastTabSession(id, cwd)
    return true
  }

  removeTab(id)
  if (wasActive) {
    const remaining = $tabs.get()
    if (remaining.length > 0) {
      switchTab(remaining[Math.min(idx, remaining.length - 1)].id)
    }
  }
  void closeTab(id).catch(() => {
    /* 后端已退出也无妨，前端状态已清 */
  })
  return true
}

async function refreshLastTabSession(id: string, cwd: string): Promise<void> {
  if (!cwd) {
    patchTab(id, {
      phase: 'ready',
      status: 'idle',
      error: '工作区路径无效。请在设置中选择工作区后再试。',
    })
    return
  }
  try {
    try {
      await restartSession(id, cwd)
    } catch {
      await startSession(id, cwd)
    }
    if (!hasTab(id)) return
    patchTab(id, { phase: 'ready', status: 'idle', error: '' })
  } catch (e) {
    if (!hasTab(id)) return
    patchTab(id, { phase: 'ready', status: 'idle', error: String(e) })
  }
}
