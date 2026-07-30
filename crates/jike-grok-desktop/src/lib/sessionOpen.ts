/**
 * 会话打开：
 * 1. hydrateFromSnapshot — get_session_messages 投影结果一次写入 UI（可命中内存缓存）
 * 2. begin/finishAttachRuntime — load_session 挂引擎；期间丢弃历史 session-update
 * 3. 实时对话 — pushTranscriptEvent → applyTranscriptEvent
 */
import { atom } from 'nanostores'
import {
  $contextUsedTokens,
  $engineStatus,
  $messages,
  $sessionPhase,
} from '../store'
import {
  applyTranscriptEvent,
  sealStreamingMessages,
  type TranscriptEvent,
} from './sessionTranscript'
import type { ChatMessage } from '../types'

/** load_session 进行中：历史 chunk 一律丢弃（跨窗口/快速切换用 atom，避免 module 全局竞态） */
export const $attachingRuntime = atom(false)

/** 防止慢请求覆盖新选择 */
export const $loadGen = atom(0)

/** 会话消息内存缓存：切走再切回可跳过 getSessionMessages 磁盘读 */
const messageCache = new Map<string, ChatMessage[]>()

export function nextLoadGen(): number {
  const n = $loadGen.get() + 1
  $loadGen.set(n)
  return n
}

export function currentLoadGen(): number {
  return $loadGen.get()
}

export function isAttachingRuntime(): boolean {
  return $attachingRuntime.get()
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
export function hydrateFromSnapshot(messages: ChatMessage[]): void {
  $messages.set(messages)
  $contextUsedTokens.set(0)
  $sessionPhase.set('loading')
  $engineStatus.set('initializing')
}

/** 开始绑定 runtime */
export function beginAttachRuntime(): void {
  $attachingRuntime.set(true)
  $sessionPhase.set('loading')
  $engineStatus.set('initializing')
}

/** runtime 就绪（load_session 返回后调用；可重复） */
export function finishAttachRuntime(): void {
  if (!$attachingRuntime.get() && $sessionPhase.get() === 'ready') return
  $attachingRuntime.set(false)
  $sessionPhase.set('ready')
  $engineStatus.set('idle')
}

/** 打开失败 / 新建会话时中止 */
export function abortOpenSession(): void {
  $attachingRuntime.set(false)
  $sessionPhase.set('ready')
  $engineStatus.set('idle')
}

/** session-event → UI；attaching 时吞掉 transcript 类历史回放 */
export function pushTranscriptEvent(ev: TranscriptEvent): boolean {
  switch (ev.type) {
    case 'agent_text_chunk':
    case 'agent_thought_chunk':
    case 'user_text_chunk':
    case 'tool_call':
    case 'tool_call_update':
      if ($attachingRuntime.get()) return true
      $messages.set(applyTranscriptEvent($messages.get(), ev))
      return true
    case 'token_usage':
      if (typeof ev.total_tokens === 'number') {
        $contextUsedTokens.set(ev.total_tokens)
      }
      return true
    case 'turn_ended':
      // 定稿思考条：停止「思考中…」、写耗时，默认折叠
      $messages.set(sealStreamingMessages($messages.get()))
      return false // 继续让 App 处理 idle 等
    case 'replay_complete':
      // 仅作为 attach 完成信号之一；主路径以 loadSession resolve 为准
      if ($attachingRuntime.get()) finishAttachRuntime()
      return true
    default:
      return false
  }
}
