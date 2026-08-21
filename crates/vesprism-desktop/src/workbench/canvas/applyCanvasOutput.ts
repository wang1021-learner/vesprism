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

/** 试跑斜杠（如 /demo-linear 或 /demo-linear { "input": 1 }）及其后的编排输出，不能拿来改画布。排除以 / 开头的文件路径 */
export function isFlowRunUserText(text: string): boolean {
  const t = (text || '').trim()
  if (!t.startsWith('/')) return false
  // 排除多级文件系统路径（如 /app/src/auth.ts, /etc/nginx 等）
  if (t.includes('/', 1)) return false
  // 严格匹配单个斜杠指令：/slug 或 /slug { JSON payload }
  return /^\/[A-Za-z0-9_-]+(?:\s*\{|\s*$)/.test(t)
}

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
    const userIdx = lastUserIndexForPrompt(messages, pid)
    if (userIdx >= 0 && isFlowRunUserText(messages[userIdx].text)) continue
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
      if (isFlowRunUserText(messages[userIdx].text)) {
        /* 试跑回合不认图 */
      } else {
        let lastA = -1
        for (let i = userIdx + 1; i < messages.length; i++) {
          if (messages[i].role === 'assistant' && messages[i].text) lastA = i
        }
        if (lastA >= 0) out.push({ index: lastA, promptId: live })
      }
    } else if (isCanvasHeal(live) && lastIdx >= 0 && looksLikeCanvasGraphJson(messages[lastIdx].text)) {
      const lastPid = resolveAssistantPromptId(messages, lastIdx)
      if (!lastPid || lastPid === live) {
        out.push({ index: lastIdx, promptId: live })
      }
    }
  }
  return out
}
