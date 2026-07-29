import type { ChatMessage, ChatRole } from '../types'
import { noteFrameTimestamp, reportStreamTick } from './streamMetrics'

export type MessagesApply = (fn: (prev: ChatMessage[]) => ChatMessage[]) => void

/** 流式/气泡仅用于非 tool 角色 */
type StreamRole = Exclude<ChatRole, 'tool'>

function asStreamRole(role: ChatRole): StreamRole {
  if (role === 'tool') return 'assistant'
  return role
}

function makeTextMessage(
  id: number,
  role: StreamRole,
  text: string,
  promptId?: string,
): ChatMessage {
  return promptId != null
    ? { id, role, text, promptId }
    : { id, role, text }
}

export type StreamTypewriter = {
  append: (role: ChatRole, text: string) => void
  push: (role: ChatRole, text: string, promptId?: string) => void
  flush: () => void
  discard: () => void
  seal: () => void
  commitSealed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  getActiveRole: () => ChatRole | null
  setActiveRole: (role: ChatRole | null) => void
  /** 当前 pending 字符数（调试） */
  getPendingChars: () => number
}

/**
 * 流式合并器：同一帧内多次 append 进 buffer，每 rAF 整段 drain 到 React。
 *
 * 不再按字符限速（旧 batchSize 会制造机械打字感）；节流交给：
 * - 官方 ReplayBuffer（initialize bufferingSettings）
 * - 桌面 Actor 侧 chunk 合并
 * - rAF + React 18 批处理
 */
export function createStreamTypewriter(opts: {
  apply: MessagesApply
  allocId: () => number
}): StreamTypewriter {
  const { apply, allocId } = opts

  let pending: { role: StreamRole; text: string } | null = null
  let raf = 0
  let activeRole: ChatRole | null = null

  const cancelRaf = () => {
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  const drainInto = (prev: ChatMessage[]): ChatMessage[] => {
    if (!pending?.text) {
      pending = null
      return prev
    }
    const { role, text } = pending
    pending = null
    if (prev.length > 0 && prev[prev.length - 1].role === role) {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      if (last.role === 'tool') {
        activeRole = role
        return [...prev, makeTextMessage(allocId(), role, text)]
      }
      copy[copy.length - 1] = { ...last, text: last.text + text }
      return copy
    }
    activeRole = role
    return [...prev, makeTextMessage(allocId(), role, text)]
  }

  const schedule = () => {
    if (raf) return
    raf = requestAnimationFrame(tick)
  }

  /** 每帧把 pending 一次清空，避免人为限速 */
  const tick = () => {
    raf = 0
    const t0 = performance.now()
    const frameDelta = noteFrameTimestamp(t0)

    if (!pending?.text) {
      pending = null
      reportStreamTick({
        tickCost: performance.now() - t0,
        commitCost: 0,
        pendingChars: 0,
        batchSize: 0,
        frameDeltaMs: frameDelta,
      })
      return
    }

    const batchUsed = pending.text.length
    const c0 = performance.now()
    apply((prev) => drainInto(prev))
    const commitCost = performance.now() - c0

    reportStreamTick({
      tickCost: performance.now() - t0,
      commitCost,
      pendingChars: 0,
      batchSize: batchUsed,
      frameDeltaMs: frameDelta,
    })
  }

  const flush = () => {
    cancelRaf()
    if (!pending?.text) {
      pending = null
      return
    }
    const batchUsed = pending.text.length
    const c0 = performance.now()
    apply((prev) => drainInto(prev))
    reportStreamTick({
      tickCost: performance.now() - c0,
      commitCost: performance.now() - c0,
      pendingChars: 0,
      batchSize: batchUsed,
    })
  }

  const discard = () => {
    cancelRaf()
    pending = null
    reportStreamTick({
      tickCost: 0,
      commitCost: 0,
      pendingChars: 0,
      batchSize: 0,
    })
  }

  const seal = () => {
    flush()
    activeRole = null
  }

  const commitSealed = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    cancelRaf()
    const c0 = performance.now()
    apply((prev) => {
      const base = drainInto(prev)
      activeRole = null
      return updater(base)
    })
    reportStreamTick({
      tickCost: performance.now() - c0,
      commitCost: performance.now() - c0,
      pendingChars: 0,
      batchSize: 0,
    })
  }

  const append = (role: ChatRole, text: string) => {
    if (!text) return
    const r = asStreamRole(role)
    const canContinue = activeRole === r || activeRole === null
    if (!canContinue) {
      flush()
      activeRole = r
    }
    if (pending && pending.role === r) {
      pending.text += text
    } else {
      if (pending?.text) flush()
      pending = { role: r, text }
    }
    if (activeRole === null) activeRole = r
    schedule()
  }

  const push = (role: ChatRole, text: string, promptId?: string) => {
    flush()
    const r = asStreamRole(role)
    activeRole = r
    apply((prev) => [...prev, makeTextMessage(allocId(), r, text, promptId)])
  }

  return {
    append,
    push,
    flush,
    discard,
    seal,
    commitSealed,
    getActiveRole: () => activeRole,
    setActiveRole: (role) => {
      activeRole = role
    },
    getPendingChars: () => pending?.text.length ?? 0,
  }
}
