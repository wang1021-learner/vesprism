/** 写台与引擎对接的隔离规则：每本书、每一轮任务互不串。 */

/** 官方 ask：只答、不给工具。写台只要对话正文，不要 write/bash。 */
export const WRITING_SESSION_MODE = 'ask'

export function needsFreshSession(kind: string): boolean {
  return (
    kind === 'write-chapter' ||
    kind === 'fill-review' ||
    kind === 'rewrite' ||
    kind === 'wash' ||
    kind === 'fill-card'
  )
}

export function taskBelongsToBook(found: { bookId?: string }, bookId: string): boolean {
  return Boolean(found.bookId && bookId && found.bookId === bookId)
}

export function sessionReady(st: { sessionId?: string; phase?: string } | null | undefined): boolean {
  return Boolean(st?.sessionId && st.phase === 'ready')
}

export async function waitUntil(
  pred: () => boolean,
  timeoutMs = 15000,
  stepMs = 50,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return pred()
}
