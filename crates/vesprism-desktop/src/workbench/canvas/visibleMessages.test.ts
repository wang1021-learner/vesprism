import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../types'
import { unwrapCanvasUserText, visibleCanvasMessages } from './visibleMessages'

function msg(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: text.slice(0, 8), role, text }
}

describe('visibleCanvasMessages', () => {
  it('试跑斜杠命令不当对话', () => {
    expect(unwrapCanvasUserText('/demo-linear {}')).toBeNull()
  })

  it('生成说明书只露出用户原话', () => {
    expect(unwrapCanvasUserText('生成流程图：客服质检\n\n你是 Vesprism')).toBe('客服质检')
    const wrapped = `你是这个流程画布的 AI 协作助手。当前流程「示例」（demo）已经画在画布上。\n用户：加一个审查节点`
    expect(unwrapCanvasUserText(wrapped)).toBe('加一个审查节点')
  })

  it('图谱 JSON 回复收成一句', () => {
    const rows = visibleCanvasMessages([
      msg('user', '加审查'),
      msg('assistant', '```json\n{"nodes":[],"edges":[]}\n```'),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[1].text).toBe('已根据对话更新画布。')
  })
})
