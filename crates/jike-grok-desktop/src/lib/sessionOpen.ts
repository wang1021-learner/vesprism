/**
 * 会话打开：
 * 1. hydrateFromSnapshot — get_session_messages 投影结果一次写入 UI（可命中内存缓存）
 * 2. begin/finishAttachRuntime — load_session 挂引擎；期间丢弃历史 session-update
 * 3. 实时对话 — pushTranscriptEvent → applyTranscriptEvent
 */
import {
  $activeTabId,
  $messages,
  getTabState,
  patchTab,
} from '../store'
import {
  applyTranscriptEvent,
  sealStreamingMessages,
  type TranscriptEvent,
} from './sessionTranscript'
import type { ChatMessage } from '../types'

/** load_session 进行中：历史 chunk 一律丢弃（按 tab 分片，避免多 tab 互相吞消息） */
const attachingTabs = new Map<string, boolean>()

/** 防止慢请求覆盖新选择（按 tab 分片：tab A 加载中切到 tab B 不影响 A 的加载） */
const loadGens = new Map<string, number>()

/** 会话消息内存缓存：切走再切回可跳过 getSessionMessages 磁盘读 */
const messageCache = new Map<string, ChatMessage[]>()

export function nextLoadGen(tabId?: string): number {
  const id = tabId ?? $activeTabId.get()
  const n = (loadGens.get(id) ?? 0) + 1
  loadGens.set(id, n)
  return n
}

export function currentLoadGen(tabId?: string): number {
  return loadGens.get(tabId ?? $activeTabId.get()) ?? 0
}

export function isAttachingRuntime(tabId?: string): boolean {
  return attachingTabs.get(tabId ?? $activeTabId.get()) ?? false
}

/** 缓存当前会话消息（切换前快照 / 投影结果） */
export function cacheSessionMessages(sessionId: string, messages: ChatMessage[]): void {
  if (!sessionId) return
  // 浅拷贝，避免后续 $messages 原地变异污染缓存
  messageCache.set(sessionId, messages.map((m) => ({ ...m })))
}

export function getCachedSessionMessages(sessionId: string): ChatMessage[] | undefined {
  const hit = messageCache.get(sessionId)
  return hit ? hit.map((m) => ({ ...m })) : undefined
}

export function invalidateSessionMessages(sessionId: string): void {
  if (sessionId) messageCache.delete(sessionId)
}

export function clearSessionMessageCache(): void {
  messageCache.clear()
}

/** 磁盘消息秒开 */
export function hydrateFromSnapshot(messages: ChatMessage[], tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  patchTab(id, { messages, phase: 'loading', status: 'initializing' })
}

/** 开始绑定 runtime */
export function beginAttachRuntime(tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  attachingTabs.set(id, true)
  patchTab(id, { phase: 'loading', status: 'initializing' })
}

/** runtime 就绪（load_session 返回后调用；可重复） */
export function finishAttachRuntime(tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  if (!attachingTabs.get(id) && getTabState(id)?.phase === 'ready') return
  attachingTabs.set(id, false)
  patchTab(id, { phase: 'ready', status: 'idle' })
}

/** 打开失败 / 新建会话时中止 */
export function abortOpenSession(tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  attachingTabs.set(id, false)
  patchTab(id, { phase: 'ready', status: 'idle' })
}

/**
 * session-event → UI；attaching 时吞掉 transcript 类历史回放。
 * tabId：事件所属 tab（按 ev.tab_id 路由，非活跃 tab 的消息也照常累积进 map）。
 */
export function pushTranscriptEvent(ev: TranscriptEvent, tabId?: string): boolean {
  const target = tabId ?? $activeTabId.get()
  // map 是事实源：目标 tab 的消息从 map 读（非活跃 tab 也能正确累积）；
  // map 里没有（理论上 App 路由已过滤）才回退当前投影。
  const cur = target ? (getTabState(target)?.messages ?? $messages.get()) : $messages.get()
  switch (ev.type) {
    case 'agent_text_chunk':
    case 'agent_thought_chunk':
    case 'user_text_chunk':
    case 'tool_call':
    case 'tool_call_update':
      if (isAttachingRuntime(target)) return true
      if (target) {
        patchTab(target, { messages: applyTranscriptEvent(cur, ev) })
      } else {
        $messages.set(applyTranscriptEvent(cur, ev))
      }
      return true
    case 'token_usage':
      return true
    case 'turn_ended':
      // 定稿思考条：停止「思考中…」、写耗时，默认折叠
      if (target) {
        patchTab(target, { messages: sealStreamingMessages(cur) })
      } else {
        $messages.set(sealStreamingMessages(cur))
      }
      return false // 继续让 App 处理 idle 等
    case 'replay_complete':
      // 仅作为 attach 完成信号之一；主路径以 loadSession resolve 为准
      if (isAttachingRuntime(target)) finishAttachRuntime(target)
      return true
    default:
      return false
  }
}
