/**
 * 画布对话可见性：试跑、生成说明书、图谱 JSON 不当正经聊天气泡。
 */
import type { ChatMessage } from '../../types'
import { innermostUserQuery } from '../../lib/sessionTitle'
import { isFlowRunUserText } from '../flow/namedWorkflowSlash'

const GENERATE_MARKERS = [
  '你是 Vesprism 流程画布的图生成器',
  '你是这个流程画布的 AI 协作助手',
  '你是这个流程画布的编排助手',
  '请严格根据当前用户意图与需求，只输出一个合法且闭合的',
  'You are the Vesprism flow-canvas orchestrator',
  'Emit ONE JSON object.',
  'interface FlowGraph',
  '<instructions>',
]

export function unwrapCanvasUserText(text: string): string | null {
  const t = (text || '').trim()
  if (!t) return null
  if (isFlowRunUserText(t)) return null
  if (t.startsWith('Your previous graph had a validation error:')) return null
  if (t.startsWith('Emit only a closed JSON')) return null
  if (t.startsWith('生成流程图：')) {
    const first = t.split('\n')[0].replace(/^生成流程图：/, '').trim()
    return first || null
  }
  const q = innermostUserQuery(t)
  if (q) return q
  const ctx = t.lastIndexOf('[Canvas Context: Flow ')
  if (ctx >= 0) {
    const head = t.slice(0, ctx).trim()
    return head || null
  }
  if (GENERATE_MARKERS.some((m) => t.includes(m))) {
    const m = t.match(/(?:User|用户)[：:]\s*([\s\S]+)$/)
    const need = m?.[1]?.trim()
    return need || null
  }
  return t
}

function graphJsonBody(text: string): string | null {
  const t = (text || '').trim()
  if (!t) return null
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : t).trim()
  if (!body.startsWith('{')) return null
  if (
    (/"nodes"\s*:/.test(body) && /"edges"\s*:/.test(body)) ||
    /"patch"\s*:/.test(body) ||
    /"update_nodes"\s*:/.test(body)
  ) {
    return body
  }
  return null
}

export function isGraphOnlyAssistant(text: string): boolean {
  return graphJsonBody(text) !== null && !assistantGraphProse(text)
}

/** JSON 围栏前的说明；纯 JSON 时为空。 */
export function assistantGraphProse(text: string): string {
  const t = (text || '').trim()
  if (!t || !graphJsonBody(t)) return ''
  const fence = t.search(/```(?:json)?/i)
  const head = (fence >= 0 ? t.slice(0, fence) : '').trim()
  if (head) return head
  if (t.startsWith('{')) return ''
  return ''
}

/** 压成一两句（预览用）；对话正文走编码 Markdown，不再裁。 */
export function clipAssistantProse(text: string, max = 160): string {
  let t = (text || '').trim()
  if (!t) return ''
  t = t.replace(/```[\s\S]*?```/g, '').trim()
  t = t.replace(/^\|.*\|$/gm, '').trim()
  t = t.replace(/^#{1,6}\s+.*$/gm, '').trim()
  t = t.split(/\n{2,}/)[0]?.trim() ?? ''
  const parts = t.split(/(?<=[。！？.!?])\s+/).filter((p) => p.trim())
  let out = parts.slice(0, 2).join('')
  if (!out) out = t
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, '')}…`
  return out.trim()
}

function isNoiseThought(m: ChatMessage): boolean {
  const t = (m.text || '').trim()
  if (!t && !m.isStreaming) return true
  if (m.isStreaming) return false
  const ms =
    m.thoughtTiming?.start && m.thoughtTiming?.end
      ? m.thoughtTiming.end - m.thoughtTiming.start
      : 0
  if (ms > 0 && ms < 800 && t.length < 120) return true
  if (ms === 0 && t.length < 40) return true
  return false
}

export function visibleCanvasMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let inRun = false
  for (const m of messages) {
    if (m.role === 'user') {
      if (isFlowRunUserText(m.text)) {
        inRun = true
        continue
      }
      const text = unwrapCanvasUserText(m.text)
      if (!text) continue
      inRun = false
      out.push({ ...m, text })
      continue
    }
    if (inRun) continue
    if (m.role === 'thought') {
      if (isNoiseThought(m)) continue
      out.push(m)
      continue
    }
    if (m.role === 'tool' && (m.toolCall || m.tool || m.text)) {
      continue
    }
    if (m.role === 'assistant' && m.text) {
      if (graphJsonBody(m.text)) {
        const prose = assistantGraphProse(m.text)
        out.push({ ...m, text: prose || '已根据对话更新画布。' })
        continue
      }
      out.push(m)
    }
  }
  return out
}
