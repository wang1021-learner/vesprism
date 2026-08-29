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

describe('decideCanvasApply', () => {
  it('散文提到 nodes/edges 不当成坏图去自愈', () => {
    expect(decideCanvasApply('我会给 nodes 和 edges 起名字', false)).toBe('drop')
  })
})

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

  it('试跑斜杠回合不能拿来改画布', () => {
    expectCanvasGraph('p_run')
    const messages = [
      u('/demo-linear {}', 'p_run'),
      a(callJson, 'p_run'),
    ]
    expect(pickCanvasApplyTargets(messages, false)).toEqual([])
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

  it('用户输入以斜杠开头的文件路径时，正常认图不被误判为试跑', () => {
    expectCanvasGraph('p_path')
    const messages = [
      u('/app/src/auth.ts 请帮我分析并画出认证流程', 'p_path'),
      a(callJson, 'p_path'),
    ]
    expect(pickCanvasApplyTargets(messages, false)).toEqual([{ index: 1, promptId: 'p_path' }])
  })

  it('用户输入 /demo-linear 或 /demo-linear { ... } 时正确识别为试跑', () => {
    expectCanvasGraph('p_run2')
    const messages = [
      u('/demo-linear', 'p_run2'),
      a(callJson, 'p_run2'),
    ]
    expect(pickCanvasApplyTargets(messages, false)).toEqual([])
  })

  it('带 --effort / --agent-budget 的试跑斜杠也不能拿来改画布', () => {
    expectCanvasGraph('p_run3')
    const messages = [
      u('/demo-linear --effort medium {"input":""}', 'p_run3'),
      a(callJson, 'p_run3'),
    ]
    expect(pickCanvasApplyTargets(messages, false)).toEqual([])
  })

  it('只认本 Tab 的 pending，不拿隔壁画布的 expect', () => {
    expectCanvasGraph('p_a', 'tab-a')
    expectCanvasGraph('p_b', 'tab-b')
    const messages = [
      u('画外呼', 'p_a'),
      a(callJson, 'p_a'),
    ]
    expect(pickCanvasApplyTargets(messages, false, 'tab-a')).toEqual([{ index: 1, promptId: 'p_a' }])
    expect(pickCanvasApplyTargets(messages, false, 'tab-b')).toEqual([])
  })
})
