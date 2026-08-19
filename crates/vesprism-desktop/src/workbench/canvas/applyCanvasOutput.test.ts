import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../types'
import { expectCanvasGraph, markCanvasHeal, resetCanvasGraphWaitForTests } from '../generateWait'
import { decideCanvasApply, pickCanvasApplyTargets } from './applyCanvasOutput'

function u(text: string, promptId: string): ChatMessage {
  return { id: promptId, role: 'user', text, promptId }
}
function a(text: string, promptId?: string): ChatMessage {
  return { id: `a_${text.slice(0, 8)}`, role: 'assistant', text, ...(promptId ? { promptId } : {}) }
}

const qaJson = '```json\n{"nodes":[{"id":"start-qa","type":"start","params":{}}],"edges":[]}\n```'
const callJson = '```json\n{"nodes":[{"id":"start-call","type":"start","params":{}}],"edges":[]}\n```'

describe('pickCanvasApplyTargets', () => {
  beforeEach(() => {
    resetCanvasGraphWaitForTests()
  })

  it('新一轮重画不能拿会话里第一份旧 JSON', () => {
    expectCanvasGraph('p_redraw')
    const messages = [
      u('做个质检流程', 'p_qa'),
      a(qaJson, 'p_qa'),
      u('重新画一下外呼流程', 'p_redraw'),
      a(callJson, 'p_redraw'),
    ]
    const hits = pickCanvasApplyTargets(messages, false)
    expect(hits).toEqual([{ index: 3, promptId: 'p_redraw' }])
    expect(messages[hits[0].index].text).toContain('start-call')
  })

  it('助手没带 promptId 时，也只认当前用户消息之后的回复', () => {
    expectCanvasGraph('p_redraw')
    const messages = [
      u('做个质检流程', 'p_qa'),
      a(qaJson),
      u('重新画一下', 'p_redraw'),
      a(callJson),
    ]
    const hits = pickCanvasApplyTargets(messages, false)
    expect(hits).toHaveLength(1)
    expect(hits[0].index).toBe(3)
    expect(messages[3].text).toContain('start-call')
  })

  it('自愈没有用户气泡时，不能拿会话第一份旧 JSON', () => {
    expectCanvasGraph('p_heal')
    markCanvasHeal('p_heal')
    const messages = [
      u('做个质检流程', 'p_qa'),
      a(qaJson, 'p_qa'),
    ]
    expect(pickCanvasApplyTargets(messages, false)).toEqual([])
  })

  it('生成中 JSON 已合法：立刻收下，不必等整轮结束', () => {
    expectCanvasGraph('p_redraw')
    const full =
      '```json\n{"nodes":[{"id":"start-call","type":"start","params":{}},{"id":"end-ok","type":"end","params":{}}],"edges":[{"from":"start-call","to":"end-ok"}]}\n```'
    const messages = [
      u('画外呼', 'p_redraw'),
      a(full + '\n\n下面再解释…', 'p_redraw'),
    ]
    expect(pickCanvasApplyTargets(messages, true)).toEqual([{ index: 1, promptId: 'p_redraw' }])
    expect(decideCanvasApply(full, true)).toBe('apply')
  })

  it('生成中 JSON 还没闭合：继续等，不自愈', () => {
    expect(decideCanvasApply('```json\n{"nodes":[', true)).toBe('wait')
  })
})
