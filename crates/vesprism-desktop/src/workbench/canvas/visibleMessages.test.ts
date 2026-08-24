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

  it('自愈纠错指令不进工作栏', () => {
    expect(
      unwrapCanvasUserText(
        'Your previous graph had a validation error: join 至少需要 2 条输入边 Fix it',
      ),
    ).toBeNull()
  })

  it('生成说明书只露出用户原话', () => {
    expect(unwrapCanvasUserText('生成流程图：客服质检\n\n你是 Vesprism')).toBe('客服质检')
    const wrapped = `你是这个流程画布的 AI 协作助手。当前流程「示例」（demo）已经画在画布上。\n用户：加一个审查节点`
    expect(unwrapCanvasUserText(wrapped)).toBe('加一个审查节点')
    const wrapped2 = `你是这个流程画布的编排助手（第二主聊天）。当前流程「示例」（demo）已经画在画布上。\n用户：[附件] src`
    expect(unwrapCanvasUserText(wrapped2)).toBe('[附件] src')
    const en = `You are the Vesprism flow-canvas orchestrator for flow "示例" (demo).\nUser:\n加一个审查节点`
    expect(unwrapCanvasUserText(en)).toBe('加一个审查节点')
    expect(
      unwrapCanvasUserText(
        '<current_graph>\n[Canvas Context: Flow "鉴权流" (id: auth-flow)]\n</current_graph>\n<user_query>\n把第三个节点改成只读\n</user_query>',
      ),
    ).toBe('把第三个节点改成只读')
    expect(
      unwrapCanvasUserText(
        '<user_query>\n<instructions>\nYou are the Vesprism flow-canvas orchestrator\n</instructions>\n<user_query>\n配置催收 Agent\n</user_query>\n</user_query>',
      ),
    ).toBe('配置催收 Agent')
  })

  it('图谱 JSON 回复收成一句', () => {
    const rows = visibleCanvasMessages([
      msg('user', '加审查'),
      msg('assistant', '```json\n{"nodes":[],"edges":[]}\n```'),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[1].text).toBe('已根据对话更新画布。')
  })

  it('思考留下，工具行不进对话', () => {
    const rows = visibleCanvasMessages([
      msg('user', '画一个外呼流程'),
      {
        id: 't1',
        role: 'thought',
        text: '用户要一个带分支的外呼流程，我先拆身份确认和挽留。',
        thoughtTiming: { start: 1000, end: 4000 },
      },
      {
        id: 'tool1',
        role: 'tool',
        text: '',
        toolCall: {
          toolCallId: 'c1',
          kind: 'read',
          status: 'completed',
          title: 'read_file',
          detail: 'agent.vue',
          preview: '',
        },
      },
      msg('assistant', '已根据对话更新画布。'),
    ])
    expect(rows.map((m) => m.role)).toEqual(['user', 'thought', 'assistant'])
  })

  it('试跑斜杠及其后回复不进对话', () => {
    const rows = visibleCanvasMessages([
      msg('user', '加一个审查节点'),
      msg('assistant', '```json\n{"nodes":[],"edges":[]}\n```'),
      msg('user', '/demo-linear {"input":"1"}'),
      msg('assistant', '开始试跑……输出一堆运行日志'),
      msg('user', '把审查改成只读'),
    ])
    expect(rows.map((m) => m.text)).toEqual([
      '加一个审查节点',
      '已根据对话更新画布。',
      '把审查改成只读',
    ])
  })

  it('长说明保留 markdown，交给对话样式渲染', () => {
    const rows = visibleCanvasMessages([
      msg('user', '设计外呼'),
      msg(
        'assistant',
        '先确认身份再分流。成功办结，失败转人工。\n\n## 四、关键设计点\n\n| 设计点 | 说明 |\n| --- | --- |\n| 分支 | keyPress |',
      ),
    ])
    expect(rows[1].text).toContain('先确认身份再分流。成功办结，失败转人工。')
    expect(rows[1].text).toContain('关键设计点')
  })

  it('JSON 前的设计说明留在对话里', () => {
    const rows = visibleCanvasMessages([
      msg('user', '加并行测试'),
      msg(
        'assistant',
        '拆成审查和测试两个并发分支，汇聚后出报告。\n```json\n{"nodes":[],"edges":[]}\n```',
      ),
    ])
    expect(rows[1].text).toBe('拆成审查和测试两个并发分支，汇聚后出报告。')
  })
})
