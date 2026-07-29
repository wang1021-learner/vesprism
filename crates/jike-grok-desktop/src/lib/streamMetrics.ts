/**
 * 流式性能指标（开发态调试用）。
 * Ctrl+Shift+D 打开浮层；也可 localStorage.debugStream=1 默认打开。
 */

export interface StreamMetrics {
  fps: number
  tickCost: number
  commitCost: number
  markdownCost: number
  pendingChars: number
  batchSize: number
  droppedFrames: number
}

const empty: StreamMetrics = {
  fps: 0,
  tickCost: 0,
  commitCost: 0,
  markdownCost: 0,
  pendingChars: 0,
  batchSize: 0,
  droppedFrames: 0,
}

let snapshot: StreamMetrics = { ...empty }
let droppedFrames = 0
let lastRafTs = 0
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getStreamMetrics(): StreamMetrics {
  return snapshot
}

export function subscribeStreamMetrics(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** tick 结束时更新（由 typewriter 调用） */
export function reportStreamTick( partial: {
  tickCost: number
  commitCost: number
  pendingChars: number
  batchSize: number
  frameDeltaMs?: number
}) {
  let fps = snapshot.fps
  if (partial.frameDeltaMs != null && partial.frameDeltaMs > 0) {
    fps = Math.round(1000 / partial.frameDeltaMs)
    // 约 <45fps 记一次掉帧
    if (partial.frameDeltaMs > 22) {
      droppedFrames += 1
    }
  }
  snapshot = {
    ...snapshot,
    fps,
    tickCost: round1(partial.tickCost),
    commitCost: round1(partial.commitCost),
    pendingChars: partial.pendingChars,
    batchSize: partial.batchSize,
    droppedFrames,
  }
  emit()
}

/** Markdown 解析结束时（主线程） */
export function reportMarkdownCost(ms: number) {
  snapshot = {
    ...snapshot,
    markdownCost: round1(ms),
  }
  emit()
}

export function resetStreamMetricsDropped() {
  droppedFrames = 0
  snapshot = { ...snapshot, droppedFrames: 0 }
  emit()
}

/** 供 rAF 外部记录帧间隔（无 tick 时仍能估 FPS） */
export function noteFrameTimestamp(now = performance.now()): number | undefined {
  if (lastRafTs <= 0) {
    lastRafTs = now
    return undefined
  }
  const delta = now - lastRafTs
  lastRafTs = now
  return delta
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function isStreamDebugPreferred(): boolean {
  try {
    return localStorage.getItem('debugStream') === '1'
  } catch {
    return false
  }
}

export function setStreamDebugPreferred(on: boolean) {
  try {
    if (on) localStorage.setItem('debugStream', '1')
    else localStorage.removeItem('debugStream')
  } catch {
    /* ignore */
  }
}
