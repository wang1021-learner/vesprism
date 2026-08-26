/**
 * 会话打开：
 * 1. hydrateFromSnapshot — get_session_messages 投影结果一次写入 UI（可命中内存缓存）
 * 2. begin/finishAttachRuntime — load_session 挂引擎；期间丢弃历史 session-update
 * 3. 实时对话 — pushTranscriptEvent → applyTranscriptEvent
 *
 * 流式合帧分两层：
 * - 引擎侧：grok-session 的 desktop_initialize_request 通过官方 bufferingSettings 打开
 *   ReplayBuffer（maxItems=32 / maxBytes=2048 / maxDurationMs=16），高频 chunk 按 ~16ms 合并。
 * - 前端侧（本文件）：高频文本 chunk 再攒进 pendingChunks，用 rAF 在显示帧边界统一 flush
 *   到 store —— 每显示帧 ≤ 1 次提交。16ms 引擎窗口与显示帧（16.67ms@60Hz / 8.33ms@120Hz）
 *   相位必然错位，直接写 store 会出现同一帧内两次提交；rAF 对齐后天然自适应帧率：
 *   高刷屏窗口自动收窄、掉帧时 rAF 间隔自动拉长给渲染腾预算。非高频事件（工具调用/回合
 *   结束/提问）到达时先同步 flush，保证事件顺序。
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

/** 高频文本 chunk 的 rAF 攒批：tabKey('' = 全局) → 待应用事件列表。 */
const pendingChunks = new Map<string, TranscriptEvent[]>()
/** 已调度的 rAF / 兜底定时器句柄。 */
let rafHandle: number | null = null
let timerHandle: ReturnType<typeof setTimeout> | null = null

/** rAF 不可用或后台标签页 rAF 暂停时的兜底窗口（ms），保证文本不卡住。 */
const RAF_FALLBACK_MS = 50

function tabKey(tabId?: string): string {
  return tabId ?? ''
}

function flushPendingChunks(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle)
    rafHandle = null
  }
  if (timerHandle !== null) {
    clearTimeout(timerHandle)
    timerHandle = null
  }
  if (pendingChunks.size === 0) return
  const batches = new Map(pendingChunks)
  pendingChunks.clear()
  for (const [key, evs] of batches) {
    if (evs.length === 0) continue
    const target = key === '' ? undefined : key
    const cur = target ? (getTabState(target)?.messages ?? $messages.get()) : $messages.get()
    const bgs = target
      ? new Set(Object.keys(getTabState(target)?.backgroundTasks || {}))
      : undefined
    let next = cur
    for (const ev of evs) {
      if (
        ev.type === 'agent_text_chunk' ||
        ev.type === 'agent_thought_chunk' ||
        ev.type === 'user_text_chunk'
      ) {
        next = applyTranscriptEvent(next, ev, bgs)
      }
    }
    if (target) {
      patchTab(target, { messages: next })
    }
  }
}

/** 把高频文本 chunk 排进 rAF 攒批；每显示帧 flush 一次（rAF 暂停时定时器兜底）。 */
function scheduleChunkFlush(target: string | undefined, ev: TranscriptEvent): void {
  const key = tabKey(target)
  const list = pendingChunks.get(key) ?? []
  list.push(ev)
  pendingChunks.set(key, list)
  if (rafHandle === null && timerHandle === null) {
    rafHandle = requestAnimationFrame(() => flushPendingChunks())
    timerHandle = setTimeout(() => flushPendingChunks(), RAF_FALLBACK_MS)
  }
}

/** 非攒批事件到达前同步落盘攒批，保证事件顺序（如 turn_ended 前的文本 chunk）。
 * 注意：flush 会 patchTab 更新 store，调用方必须在 flush 后重新读取 messages，
 * 不能用 flush 前的快照（否则覆盖掉刚落盘的文本）。 */
function flushBeforeSequential(): void {
  if (pendingChunks.size === 0) return
  flushPendingChunks()
}

// 后台标签页 rAF 暂停时，切回前台立即 flush 未落盘的文本。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) flushPendingChunks()
  })
}

export function nextLoadGen(tabId?: string): number {
  const id = tabId ?? $activeTabId.get()
  const n = (loadGens.get(id) ?? 0) + 1
  loadGens.set(id, n)
  return n
}

export function currentLoadGen(tabId?: string): number {
  return loadGens.get(tabId ?? $activeTabId.get()) ?? 0
}

/** restart/start 后等 session_id_changed 写入 tab，避免读到旧 id。 */
export async function waitTabSessionId(
  tabId: string,
  prevId?: string,
  timeoutMs = 4000,
): Promise<string> {
  const started = Date.now()
  const prev = (prevId ?? '').trim()
  while (Date.now() - started < timeoutMs) {
    const sid = (getTabState(tabId)?.sessionId || '').trim()
    if (sid && sid !== prev) return sid
    await new Promise((r) => setTimeout(r, 40))
  }
  return (getTabState(tabId)?.sessionId || '').trim()
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
  switch (ev.type) {
    case 'agent_text_chunk':
    case 'agent_thought_chunk':
    case 'user_text_chunk': {
      // 高频文本 chunk：rAF 攒批，显示帧边界统一提交；attach 期间照旧丢弃。
      if (isAttachingRuntime(target)) return true
      scheduleChunkFlush(target, ev)
      return true
    }
    case 'tool_call':
    case 'tool_call_update':
    case 'user_question_request':
    case 'user_question_resolved':
    case 'exit_plan_mode_request':
    case 'exit_plan_mode_resolved': {
      if (isAttachingRuntime(target)) return true
      // 顺序事件前先落盘攒批的文本（保序）；flush 后重新读 store，避免覆盖刚落盘的文本。
      flushBeforeSequential()
      const cur = target ? (getTabState(target)?.messages ?? $messages.get()) : $messages.get()
      const bgs = target ? new Set(Object.keys(getTabState(target)?.backgroundTasks || {})) : undefined
      if (target) {
        patchTab(target, { messages: applyTranscriptEvent(cur, ev, bgs) })
      }
      // 问卷 / 计划稿审批还需挂起面板，不吞掉
      if (ev.type === 'user_question_request' || ev.type === 'exit_plan_mode_request') {
        return false
      }
      return true
    }
    case 'token_usage':
      if (target && typeof ev.total_tokens === 'number') {
        patchTab(target, { totalTokens: ev.total_tokens })
      }
      return true
    case 'turn_ended': {
      // 定稿思考条：停止「思考中…」、写耗时，默认折叠；
      // 带 prompt_id 做回合归属判断（旧回合迟到收尾只 seal 旧区）
      // 先 flush 攒批文本，保证 seal 前该回合全部文本已落盘；flush 后重读 store。
      flushBeforeSequential()
      const cur = target ? (getTabState(target)?.messages ?? $messages.get()) : $messages.get()
      const bgs = target ? new Set(Object.keys(getTabState(target)?.backgroundTasks || {})) : undefined
      if (target) {
        patchTab(target, { messages: sealStreamingMessages(cur, ev.prompt_id, bgs) })
      }
      return false // 继续让 App 处理 idle 等
    }
    case 'replay_complete':
      // 仅作为 attach 完成信号之一；主路径以 loadSession resolve 为准
      if (isAttachingRuntime(target)) finishAttachRuntime(target)
      return true
    default:
      return false
  }
}
