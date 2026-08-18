/**
 * 画布对话可见性：试跑、生成说明书、图谱 JSON 不当正经聊天气泡。
 */
import type { ChatMessage } from '../../types'

const GENERATE_MARKERS = [
  '你是 Vesprism 流程画布的图生成器',
  '你是这个流程画布的 AI 协作助手',
  '请严格根据当前用户意图与需求，只输出一个合法且闭合的',
]

export function unwrapCanvasUserText(text: string): string | null {
  const t = (text || '').trim()
  if (!t) return null
  if (/^\//.test(t)) return null
  if (t.startsWith('生成流程图：')) {
    const first = t.split('\n')[0].replace(/^生成流程图：/, '').trim()
    return first || null
  }
  if (GENERATE_MARKERS.some((m) => t.includes(m))) {
    const m = t.match(/用户[：:]\s*([\s\S]+)$/)
    const need = m?.[1]?.trim()
    return need || null
  }
  return t
}

export function isGraphOnlyAssistant(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : t).trim()
  if (!body.startsWith('{')) return false
  return /"nodes"\s*:/.test(body) && /"edges"\s*:/.test(body)
}

export function visibleCanvasMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const text = unwrapCanvasUserText(m.text)
      if (!text) continue
      out.push({ ...m, text })
      continue
    }
    if (m.role === 'assistant' && m.text) {
      if (isGraphOnlyAssistant(m.text)) {
        out.push({ ...m, text: '已根据对话更新画布。' })
        continue
      }
      out.push(m)
    }
  }
  return out
}
