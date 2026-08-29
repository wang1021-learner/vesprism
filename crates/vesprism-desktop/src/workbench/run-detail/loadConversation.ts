/**
 * 试跑详情「打开对话」：从子会话磁盘投影拉消息，失败时用产出摘要兜底。
 */
import type { ChatMessage } from '../../types'
import { generateId } from '../../lib/generateId'
import { mapDisplayMessages } from '../../lib/openSubagentTab'
import type { MemberRow } from '../../lib/subagentRunTree'

export function conversationSessionIds(
  m: Pick<MemberRow, 'childSessionId' | 'agentId'>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const child = (m.childSessionId || '').trim()
  if (child) {
    out.push(child)
    seen.add(child)
  }
  const agent = (m.agentId || '').trim()
  // 已有子会话 id 就不再拿 agentId 去撞会话目录（编制 id / 节点 id 会空打一次）。
  if (agent && !seen.has(agent) && !child) out.push(agent)
  return out
}

export function withOutputFallback(messages: ChatMessage[], output?: string): ChatMessage[] {
  const fallback = (output || '').trim()
  if (!fallback) return messages
  const hasAssistant = messages.some((m) => m.role === 'assistant' && m.text.trim())
  if (hasAssistant) return messages
  return [...messages, { id: generateId('msg_'), role: 'assistant', text: fallback }]
}

export type LoadConversationResult = {
  sessionId: string
  messages: ChatMessage[]
  error: string
}

function isMissingSession(err: unknown): boolean {
  const t = String(err)
  return t.includes('找不到会话目录') || t.includes('not found')
}

export async function loadRunConversation(
  ids: string[],
  output: string | undefined,
  getMessages: (sessionId: string) => Promise<
    Array<{
      id: string
      role: string
      text: string
      tool?: string | null
      tool_call_id?: string | null
      prompt_id?: string | null
      kind?: string | null
      status?: string | null
      detail?: string | null
      preview?: string | null
      start_ms?: number | null
      end_ms?: number | null
    }>
  >,
): Promise<LoadConversationResult> {
  const fallback = withOutputFallback([], output)
  if (ids.length === 0) {
    return {
      sessionId: '',
      messages: fallback,
      error: fallback.length ? '' : '没有可查看的对话',
    }
  }
  let lastErr = ''
  for (const sessionId of ids) {
    try {
      const raw = await getMessages(sessionId)
      const messages = withOutputFallback(mapDisplayMessages(raw), output)
      return { sessionId, messages, error: '' }
    } catch (e) {
      lastErr = String(e)
      if (!isMissingSession(e)) {
        return {
          sessionId,
          messages: fallback,
          error: fallback.length ? '' : `加载对话失败：${lastErr}`,
        }
      }
    }
  }
  return {
    sessionId: ids[0] || '',
    messages: fallback,
    error: fallback.length ? '' : lastErr ? `加载对话失败：${lastErr}` : '没有可查看的对话',
  }
}
