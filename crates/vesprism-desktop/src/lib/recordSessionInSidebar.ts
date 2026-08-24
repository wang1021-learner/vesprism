/**
 * 第一次向 AI 说话时，侧栏立刻出现这条会话。
 * 编码写入 $chats；工作台挂 binding（不要求已经保存 Flow/Agent）。
 */
import { touchWorkbenchSession } from '../workbench/bindings'
import {
  $activeTabId,
  $chats,
  getTabState,
  patchTab,
  type ChatSummary,
} from '../store'
import { cleanSessionTitle } from './sessionTitle'

export const CHATS_CHANGED_EVENT = 'vesprism:chats-changed'

export function notifyChatsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHATS_CHANGED_EVENT))
}

export function upsertLiveChat(summary: ChatSummary): void {
  const id = summary.id.trim()
  if (!id) return
  const prev = $chats.get()
  const i = prev.findIndex((c) => c.id === id)
  if (i < 0) {
    $chats.set([summary, ...prev])
    return
  }
  const next = [...prev]
  const merged: ChatSummary = {
    ...next[i]!,
    ...summary,
    title: summary.title.trim() || next[i]!.title,
  }
  next.splice(i, 1)
  $chats.set([merged, ...next])
}

/** 编码索引还没跟上时，别把当前这条会话从侧栏刷掉。 */
export function preserveActiveLiveChat(listed: ChatSummary[]): ChatSummary[] {
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : undefined
  if (!st || st.utilityKind) return listed
  const sid = (st.chatId || st.sessionId || '').trim()
  if (!sid || listed.some((c) => c.id === sid)) return listed
  const prev = $chats.get().find((c) => c.id === sid)
  if (prev) return [prev, ...listed]
  return [
    {
      id: sid,
      title: st.chatTitle.trim() || '新对话',
      cwd: st.cwd || '',
      updatedAt: new Date().toISOString(),
    },
    ...listed,
  ]
}

export async function recordLiveSession(tabId: string, userText: string): Promise<void> {
  const st = getTabState(tabId)
  if (!st) return
  const kind = st.utilityKind
  if (kind && kind !== 'flow-canvas' && kind !== 'agents') return
  const sid = (st.sessionId || st.chatId || '').trim()
  if (!sid) return
  if (!st.chatId) patchTab(tabId, { chatId: sid })
  const title = cleanSessionTitle(userText, st.chatTitle || '新对话') || '新对话'
  const cwd = st.cwd || ''
  const summary: ChatSummary = {
    id: sid,
    title,
    cwd,
    updatedAt: new Date().toISOString(),
  }
  if (kind === 'flow-canvas' || kind === 'agents') {
    try {
      await touchWorkbenchSession(sid, kind, title, cwd)
    } catch {
      /* 侧栏下一轮刷新再试 */
    }
  } else {
    upsertLiveChat(summary)
  }
  notifyChatsChanged()
}
