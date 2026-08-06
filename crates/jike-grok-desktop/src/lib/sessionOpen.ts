/**
 * 会话打开：
 * 1. hydrateFromSnapshot — get_session_messages 投影结果一次写入 UI（可命中内存缓存）
 * 2. begin/finishAttachRuntime — load_session 挂引擎；期间丢弃历史 session-update
 * 3. 实时对话 — pushTranscriptEvent → applyTranscriptEvent
 *
 * 流式合帧在引擎侧完成：grok-session 的 desktop_initialize_request 通过官方
 * bufferingSettings 打开 xai-grok-shell 的 ReplayBuffer
 * （maxItems=32 / maxBytes=2048 / maxDurationMs=16），高频 agent_message_chunk /
 * agent_thought_chunk 已按 ~16ms 一档合并后才推给前端。前端因此直接写 store：
 * 每个事件 ≤ 一帧，无额外延迟、无缓冲竞态。渲染端（虚拟列表 + memo + streamdown
 * 增量解析）保证单次更新的成本与增量成正比，无需再在事件层做二次合帧。
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

/** load_session 进行中：历史 chunk 一律丢弃（按 tab 分片） */
const attachingTabs = new Map<string, boolean>()
const loadGens = new Map<string, number>()
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

export function cacheSessionMessages(sessionId: string, messages: ChatMessage[]): void {
  if (!sessionId) return
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

export function hydrateFromSnapshot(messages: ChatMessage[], tabId?: string): void {
  patchTab(tabId ?? $activeTabId.get(), { messages, phase: 'loading', status: 'initializing' })
}

export function beginAttachRuntime(tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  attachingTabs.set(id, true)
  patchTab(id, { phase: 'loading', status: 'initializing' })
}

export function finishAttachRuntime(tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  if (!attachingTabs.get(id) && getTabState(id)?.phase === 'ready') return
  attachingTabs.set(id, false)
  patchTab(id, { phase: 'ready', status: 'idle' })
}

export function abortOpenSession(tabId?: string): void {
  const id = tabId ?? $activeTabId.get()
  attachingTabs.set(id, false)
  patchTab(id, { phase: 'ready', status: 'idle' })
}

export function pushTranscriptEvent(ev: TranscriptEvent, tabId?: string): boolean {
  const target = tabId ?? $activeTabId.get()
  const cur = target ? (getTabState(target)?.messages ?? $messages.get()) : $messages.get()
  switch (ev.type) {
    case 'agent_text_chunk':
    case 'agent_thought_chunk':
    case 'user_text_chunk':
    case 'tool_call':
    case 'tool_call_update':
    case 'user_question_request':
    case 'user_question_resolved':
      if (isAttachingRuntime(target)) return true
      if (target) {
        patchTab(target, { messages: applyTranscriptEvent(cur, ev) })
      } else {
        $messages.set(applyTranscriptEvent(cur, ev))
      }
      // user_question_request 还需 App 挂起问卷面板，不吞掉
      if (ev.type === 'user_question_request') return false
      return true
    case 'token_usage':
      return true
    case 'turn_ended':
      // 定稿思考条：停止「思考中…」、写耗时，默认折叠；
      // 带 prompt_id 做回合归属判断（旧回合迟到收尾只 seal 旧区）
      if (target) {
        patchTab(target, { messages: sealStreamingMessages(cur, ev.prompt_id) })
      } else {
        $messages.set(sealStreamingMessages(cur, ev.prompt_id))
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
