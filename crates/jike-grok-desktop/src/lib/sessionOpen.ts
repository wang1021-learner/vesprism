/**
 * 会话打开（Codex 风格，无旧回放兼容）：
 * 1. hydrateFromSnapshot — get_session_messages 投影结果一次写入 UI
 * 2. begin/finishAttachRuntime — load_session 挂引擎；期间丢弃历史 session-update
 * 3. 实时对话 — pushTranscriptEvent → applyTranscriptEvent
 */
import {
  $contextUsedTokens,
  $engineStatus,
  $messages,
  $sessionPhase,
} from '../store'
import {
  applyTranscriptEvent,
  type TranscriptEvent,
} from './sessionTranscript'
import type { ChatMessage } from '../types'

/** load_session 进行中：历史 chunk 一律丢弃 */
let attaching = false

/** 防止慢请求覆盖新选择 */
let loadGen = 0

export function nextLoadGen(): number {
  loadGen += 1
  return loadGen
}

export function currentLoadGen(): number {
  return loadGen
}

export function isAttachingRuntime(): boolean {
  return attaching
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
  attaching = true
  $sessionPhase.set('loading')
  $engineStatus.set('initializing')
}

/** runtime 就绪（load_session 返回后调用；可重复） */
export function finishAttachRuntime(): void {
  if (!attaching && $sessionPhase.get() === 'ready') return
  attaching = false
  $sessionPhase.set('ready')
  $engineStatus.set('idle')
}

/** 打开失败 / 新建会话时中止 */
export function abortOpenSession(): void {
  attaching = false
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
      if (attaching) return true
      $messages.set(applyTranscriptEvent($messages.get(), ev))
      return true
    case 'token_usage':
      if (typeof ev.total_tokens === 'number') {
        $contextUsedTokens.set(ev.total_tokens)
      }
      return true
    case 'replay_complete':
      // 仅作为 attach 完成信号之一；主路径以 loadSession resolve 为准
      if (attaching) finishAttachRuntime()
      return true
    default:
      return false
  }
}
