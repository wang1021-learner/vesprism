/**
 * 从当前对话里挑「这一轮」该上画布的助手回复。
 * 禁止用更早回合里的 JSON 去满足新的 expectCanvasGraph。
 * JSON 一经合法就该上画布，不必等整轮话说完。
 */
import type { ChatMessage } from '../../types'
import { resolveAssistantPromptId } from '../../lib/sessionTranscript'
import {
  looksLikeCanvasGraphJson,
  parseCanvasModelOutput,
} from '../flow/schema'
import {
  isCanvasHeal,
  isPendingCanvasGraph,
  latestExpectedCanvasGraph,
} from '../generateWait'

export function lastUserIndexForPrompt(messages: ChatMessage[], promptId: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].promptId === promptId) return i
  }
  return -1
}

export function decideCanvasApply(
  text: string,
  generating: boolean,
): 'apply' | 'wait' | 'heal' | 'drop' {
  const parsed = parseCanvasModelOutput(text)
  if (parsed.ok) return 'apply'
  if (generating) return 'wait'
  if (looksLikeCanvasGraphJson(text)) return 'heal'
  return 'drop'
}

export function pickCanvasApplyTargets(
  messages: ChatMessage[],
  generating: boolean,
): Array<{ index: number; promptId: string }> {
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.text)
  const lastIdx = last ? messages.lastIndexOf(last) : -1

  const lastByPid = new Map<string, number>()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.text) continue
    const pid = resolveAssistantPromptId(messages, i)
    if (!pid || !isPendingCanvasGraph(pid)) continue
    lastByPid.set(pid, i)
  }

  const out: Array<{ index: number; promptId: string }> = []
  for (const [promptId, index] of lastByPid) {
    out.push({ index, promptId })
  }

  const live = latestExpectedCanvasGraph()
  if (!generating && live && isPendingCanvasGraph(live) && !lastByPid.has(live)) {
    const userIdx = lastUserIndexForPrompt(messages, live)
    if (userIdx >= 0) {
      let lastA = -1
      for (let i = userIdx + 1; i < messages.length; i++) {
        if (messages[i].role === 'assistant' && messages[i].text) lastA = i
      }
      if (lastA >= 0) out.push({ index: lastA, promptId: live })
    } else if (isCanvasHeal(live) && lastIdx >= 0 && looksLikeCanvasGraphJson(messages[lastIdx].text)) {
      const lastPid = resolveAssistantPromptId(messages, lastIdx)
      if (!lastPid || lastPid === live) {
        out.push({ index: lastIdx, promptId: live })
      }
    }
  }
  return out
}
