/**
 * 官方 x.ai/queue/changed 的桌面合并规则。
 * 纯函数：乐观列表 + 服务器 entries + 开跑后的用户气泡。
 */
import type { ChatMessage } from '../types'
import { generateId } from './generateId'

export type QueueRow = {
  id: string
  version: number
  text: string
  position: number
  combinedTexts?: string[]
}

export function mergeQueueEntries(
  server: QueueRow[],
  local: QueueRow[],
  runningId?: string,
): QueueRow[] {
  const sorted = [...server].sort((a, b) => a.position - b.position)
  const serverIds = new Set(sorted.map((e) => e.id))
  const extras = local.filter((q) => !serverIds.has(q.id) && q.id !== runningId)
  if (!extras.length) return sorted
  return [
    ...sorted,
    ...extras.map((q, i) => ({ ...q, position: sorted.length + i })),
  ]
}

export function moveQueuedPrompt(
  rows: QueueRow[],
  id: string,
  delta: -1 | 1,
): QueueRow[] {
  const i = rows.findIndex((q) => q.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= rows.length) return rows
  const next = rows.slice()
  const [item] = next.splice(i, 1)
  next.splice(j, 0, item)
  return next.map((q, position) => ({ ...q, position }))
}

export function runningUserTexts(
  runningText?: string,
  combinedTexts?: string[],
): string[] {
  const segs = (combinedTexts ?? []).map((s) => s.trim()).filter(Boolean)
  if (segs.length >= 2) return segs
  const one = (runningText ?? '').trim()
  return one ? [one] : []
}

export function paintRunningUserBubbles(
  messages: ChatMessage[],
  runningId: string,
  runningText?: string,
  combinedTexts?: string[],
): ChatMessage[] {
  const texts = runningUserTexts(runningText, combinedTexts)
  if (!texts.length) return messages
  const idxs = messages
    .map((m, i) => (m.role === 'user' && m.promptId === runningId ? i : -1))
    .filter((i) => i >= 0)
  if (idxs.length >= texts.length) return messages
  const bubbles: ChatMessage[] = texts.map((text) => ({
    id: generateId('msg_'),
    role: 'user',
    text,
    promptId: runningId,
  }))
  if (idxs.length === 0) return [...messages, ...bubbles]
  const insertAt = idxs[0]
  const without = messages.filter((_, i) => !idxs.includes(i))
  return [...without.slice(0, insertAt), ...bubbles, ...without.slice(insertAt)]
}
