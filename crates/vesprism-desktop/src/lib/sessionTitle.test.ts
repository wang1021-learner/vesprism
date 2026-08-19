import { describe, expect, it } from 'vitest'
import { cleanSessionTitle, innermostUserQuery } from './sessionTitle'

const nested = `<user_query>
<instructions>
You are the Vesprism flow-canvas orchestrator for flow "示例流程" (demo-linear).
</instructions>
<current_graph>
[Canvas Context: Flow "示例流程" (id: demo-linear)]
</current_graph>
<user_query>
你根据他的agent配置一个agent
</user_query>
</user_query>`

describe('cleanSessionTitle', () => {
  it('嵌套 user_query 取最里层用户原话', () => {
    expect(innermostUserQuery(nested)).toBe('你根据他的agent配置一个agent')
    expect(cleanSessionTitle(nested)).toBe('你根据他的agent配置一个agent')
  })

  it('首段是说明书时不要把 <instructions> 当标题', () => {
    expect(cleanSessionTitle('<instructions> You are t…')).toBe('新对话')
  })

  it('官方生成的正常标题原样保留', () => {
    expect(cleanSessionTitle('AI客服平台流程编排与Agent配置代码分析')).toBe(
      'AI客服平台流程编排与Agent配置代码分析',
    )
  })

  it('旧中文包装只留用户句', () => {
    expect(cleanSessionTitle('生成流程图：客服质检\n\n你是 Vesprism')).toBe('客服质检')
    expect(
      cleanSessionTitle('你是这个流程画布的 AI 协作助手。\n用户：加一个审查节点'),
    ).toBe('加一个审查节点')
  })
})
