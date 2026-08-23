import type { ChatMessage } from '../types'

/** 子任务派发词不当作用户提问（不计 rewind 序号、不进 sticky）。 */
export function isHiddenUserMessage(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  if (/的子\s*agent/i.test(t) && t.length > 40) return true
  if (/^你是负责.+子\s*agent/i.test(t)) return true
  if (/you are a sub-?agent/i.test(t) && t.length > 40) return true
  return false
}

export function isVisibleUserMessage(msg: ChatMessage | undefined): boolean {
  return Boolean(msg && msg.role === 'user' && !isHiddenUserMessage(msg.text || ''))
}

export function visibleUserMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(isVisibleUserMessage)
}

/** 某条助手回复对应的提问（向前找最近可见用户条）。 */
export function originUserMessage(
  messages: ChatMessage[],
  assistantId: string,
): ChatMessage | null {
  const i = messages.findIndex((m) => m.id === assistantId)
  if (i < 0) return null
  for (let j = i - 1; j >= 0; j--) {
    if (isVisibleUserMessage(messages[j])) return messages[j]
  }
  return null
}

/** 可见用户条在 rewind 序号中的位置（0-based）。 */
export function promptIndexForUserId(
  messages: ChatMessage[],
  userId: string,
): number | null {
  const users = visibleUserMessages(messages)
  const idx = users.findIndex((u) => u.id === userId)
  return idx >= 0 ? idx : null
}

export function lastAssistantId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i].id
  }
  return null
}

/**
 * 最新助手回复可重试：其后不能再有用户/助手条，且整轮不在生成。
 * 避免「新提问已发出仍重试上一轮」把新话抹掉。
 */
export function canRetryAssistant(
  messages: ChatMessage[],
  assistantId: string,
  sessionBusy: boolean,
): boolean {
  if (sessionBusy || !assistantId) return false
  const i = messages.findIndex((m) => m.id === assistantId)
  if (i < 0) return false
  for (let j = i + 1; j < messages.length; j++) {
    const role = messages[j].role
    if (role === 'user' || role === 'assistant') return false
  }
  return messages[i].role === 'assistant'
}

/**
 * 视口首条（不含 overscan）之上最近的提问。
 * 首条已是可见用户条则不钉，避免和气泡叠两份。
 */
export function stickyUserIndex(
  messages: ChatMessage[],
  firstVisibleIndex: number,
): number {
  if (firstVisibleIndex <= 0 || firstVisibleIndex >= messages.length) return -1
  if (isVisibleUserMessage(messages[firstVisibleIndex])) return -1
  for (let i = firstVisibleIndex - 1; i >= 0; i--) {
    if (isVisibleUserMessage(messages[i])) return i
  }
  return -1
}

export function stickyUserPreview(text: string, max = 88): string {
  const collapsed = (text || '').replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
