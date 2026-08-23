import type { ChatMessage } from '../types'

export function messageFindText(m: ChatMessage): string {
  const bits = [m.text, m.toolCall?.title, m.toolCall?.detail, m.toolCall?.preview]
  return bits.filter(Boolean).join('\n')
}

/** 对话里可搜的行下标（用户 / 助手 / 工具标题）。 */
export function findMessageHits(messages: ChatMessage[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messageFindText(messages[i]).toLowerCase().includes(q)) hits.push(i)
  }
  return hits
}

export function nextHit(hits: number[], current: number, dir: 1 | -1): number {
  if (!hits.length) return -1
  if (current < 0) return dir === 1 ? hits[0] : hits[hits.length - 1]
  const pos = hits.indexOf(current)
  if (pos < 0) {
    if (dir === 1) {
      const n = hits.find((i) => i > current)
      return n ?? hits[0]
    }
    const prev = [...hits].reverse().find((i) => i < current)
    return prev ?? hits[hits.length - 1]
  }
  const next = (pos + dir + hits.length) % hits.length
  return hits[next]
}
