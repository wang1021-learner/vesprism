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

  it('branch 生成 if / else，flow 节点写入依赖调用说明', () => {
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
        { id: 'ok', type: 'flow', params: { flowId: 'other-flow' } },
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
    expect(rhai).toContain('invoke other-flow')
    expect(rhai).toContain('capability_mode: "execute"')
  })

  it('草稿含绝对路径时被检测', () => {
    const d = createDemoDraft()
    expect(draftHasAbsolutePath(d)).toBeNull()
    ;(d.nodes[1].params as { prompt?: string }).prompt = 'read C:\\\\Users\\\\me\\\\secret.txt'
    expect(draftHasAbsolutePath(d)).toMatch(/绝对路径/)
  })
})
