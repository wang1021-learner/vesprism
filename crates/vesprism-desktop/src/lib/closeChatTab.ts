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
  bumpPtyEpoch,
  markPtyAlive,
  patchTab,
  removeTab,
  resetTabToNewChat,
  resolveWorkspaceCwd,
  shellForUtility,
  switchTab,
  tabsForShell,
} from '../store'
import { closeTab, killTask, restartSession, startSession, stopPty } from '../bridge'

/** 关 Tab 时先杀该会话登记的后台进程，避免条目没了进程还在。 */
function killTabBackgroundTasks(tabId: string): void {
  const tasks = getTabState(tabId)?.backgroundTasks ?? {}
  for (const t of Object.values(tasks)) {
    if (t.taskId) void killTask(tabId, t.taskId).catch(() => {})
  }
}

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
  const closedShell = shellForUtility(st?.utilityKind)

  killTabBackgroundTasks(id)
  markPtyAlive(id, false)

  if (isLast) {
    const cwd = resolveWorkspaceCwd()
    resetTabToNewChat(id, cwd)
    // 先杀掉再 bump，避免 TerminalPane 重挂时 start 抢在 stop 前面。
    void stopPty(id)
      .catch(() => {})
      .finally(() => bumpPtyEpoch(id))
    void refreshLastTabSession(id, cwd)
    return true
  }

  void stopPty(id).catch(() => {})

  removeTab(id)
  if (wasActive) {
    const remaining = $tabs.get()
    const sameShell = tabsForShell(closedShell, remaining)
    if (sameShell.length > 0) {
      switchTab(sameShell[Math.min(idx, sameShell.length - 1)].id)
    } else if (remaining.length > 0) {
      // 本壳没 Tab 了：后台落到另一边，界面仍留在当前壳（工作台回入口页）。
      switchTab(remaining[Math.min(idx, remaining.length - 1)].id, { syncShell: false })
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
      error: '无法重建会话：闲聊目录不可用。',
    })
    return
  }
  try {
    const st = getTabState(id)
    const spawn = { modelId: st?.modelId, reasoningEffort: st?.reasoningEffort }
    try {
      await restartSession(id, cwd, spawn)
    } catch {
      await startSession(id, cwd, spawn)
    }
    if (!hasTab(id)) return
    patchTab(id, { phase: 'ready', status: 'idle', error: '' })
  } catch (e) {
    if (!hasTab(id)) return
    patchTab(id, { phase: 'ready', status: 'idle', error: String(e) })
  }
}
