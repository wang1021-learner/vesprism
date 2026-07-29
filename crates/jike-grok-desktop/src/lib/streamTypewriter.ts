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

function takeCodePoints(s: string, maxUnits: number): [string, string] {
  if (s.length <= maxUnits) return [s, '']
  let i = 0
  let taken = 0
  while (i < s.length && taken < maxUnits) {
    const cp = s.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    taken += 1
  }
  return [s.slice(0, i), s.slice(i)]
}

function batchSize(pendingLen: number): number {
  // 对齐 V2 动态档位思路，略保守
  if (pendingLen > 8000) return 256
  if (pendingLen > 2000) return 128
  if (pendingLen > 500) return 64
  if (pendingLen > 120) return 32
  if (pendingLen > 40) return 16
  if (pendingLen > 12) return 8
  if (pendingLen > 4) return 4
  return 2
}

/**
 * 流式打字机：buffer + rAF + activeRole + StreamMetrics 采样。
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

    const role = pending.role
    const pendingBefore = pending.text.length
    const take = batchSize(pendingBefore)
    const [chunk, rest] = takeCodePoints(pending.text, take)
    pending.text = rest
    if (!rest) pending = null
    const batchUsed = chunk.length

    const c0 = performance.now()
    apply((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].role === role) {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last.role !== 'tool') {
          copy[copy.length - 1] = { ...last, text: last.text + chunk }
          activeRole = role
          return copy
        }
      }
      activeRole = role
      return [...prev, makeTextMessage(allocId(), role, chunk)]
    })
    const commitCost = performance.now() - c0
    const tickCost = performance.now() - t0

    reportStreamTick({
      tickCost,
      commitCost,
      pendingChars: pending?.text.length ?? 0,
      batchSize: batchUsed,
      frameDeltaMs: frameDelta,
    })

    if (pending?.text) schedule()
  }

  const flush = () => {
    cancelRaf()
    if (!pending?.text) {
      pending = null
      return
    }
    const c0 = performance.now()
    apply((prev) => drainInto(prev))
    reportStreamTick({
      tickCost: performance.now() - c0,
      commitCost: performance.now() - c0,
      pendingChars: 0,
      batchSize: 0,
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
