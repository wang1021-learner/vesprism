import { describe, expect, it } from 'vitest'
import { createDemoDraft, draftHasAbsolutePath } from './graph'
import { compileToRhai, listReachable } from './rhai'
import type { FlowDraft } from './types'

describe('compileToRhai', () => {
  it('三节点 demo 导出可被官方发现的 meta + agent + complete', () => {
    const rhai = compileToRhai(createDemoDraft())
    expect(rhai).toContain('let meta = #{')
    expect(rhai).toContain('name: "demo-linear"')
    expect(rhai).toContain('phase("摘要")')
    expect(rhai).toContain('agent(')
    expect(rhai).toContain('complete(')
    expect(rhai).not.toMatch(/position/)
    expect(rhai).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(listReachable(createDemoDraft()).sort()).toEqual(['agent-1', 'end-1', 'start-1'])
  })

  it('branch 生成 if / else；未内联的 flow 节点拒绝编译', () => {
    const draft: FlowDraft = {
      id: 'with-branch',
      name: '分支示例',
      description: '给 agent 看的说明',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'b', type: 'branch', params: { condition: 'success' } },
        { id: 'ok', type: 'agent', params: { label: '成功', prompt: '处理成功' } },
        { id: 'ng', type: 'tool', params: { command: 'echo fail' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'b' },
        { from: 'b', to: 'ok', label: 'success' },
        { from: 'b', to: 'ng', label: 'failure' },
        { from: 'ok', to: 'e' },
        { from: 'ng', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('if (')
    expect(rhai).toContain('} else {')
    expect(rhai).toContain('处理成功')
    expect(rhai).toContain('capability_mode: "execute"')
    expect(rhai).not.toContain('invoke')
    expect(() =>
      compileToRhai({
        ...draft,
        nodes: draft.nodes.map((n) =>
          n.id === 'ok' ? { ...n, type: 'flow', params: { flowId: 'other-flow' } } : n,
        ),
      }),
    ).toThrow(/未内联/)
  })

  it('preset 解析进 AgentOpts，不写进提示词', () => {
    const d = createDemoDraft()
    ;(d.nodes[1].params as { presetId?: string }).presetId = 'coding'
    expect(() => compileToRhai(d)).toThrow(/组装单「coding」不存在/)
    const rhai = compileToRhai(d, {
      presets: { coding: { model: 'grok-4', agentType: 'explore' } },
    })
    expect(rhai).toContain('model: "grok-4"')
    expect(rhai).toContain('agent_type: "explore"')
    expect(rhai).not.toContain('你按组装单')
  })

  it('草稿含绝对路径时被检测', () => {
    const d = createDemoDraft()
    expect(draftHasAbsolutePath(d)).toBeNull()
    ;(d.nodes[1].params as { prompt?: string }).prompt = 'read C:\\\\Users\\\\me\\\\secret.txt'
    expect(draftHasAbsolutePath(d)).toMatch(/绝对路径/)
  })
})
