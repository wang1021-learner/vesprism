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

  it('Agent 解析进 AgentOpts，不写进提示词', () => {
    const d = createDemoDraft()
    ;(d.nodes[1].params as { presetId?: string }).presetId = 'coding'
    expect(() => compileToRhai(d)).toThrow(/Agent「coding」不存在/)
    const rhai = compileToRhai(d, {
      presets: { coding: { model: 'grok-4', agentType: 'explore' } },
    })
    expect(rhai).toContain('model: "grok-4"')
    expect(rhai).toContain('agent_type: "explore"')
    expect(rhai).not.toContain('你按组装单')
  })

  it('Agent 的 capability / isolation / output_schema / disabled_tools / permission_rules 编译进官方 AgentOpts', () => {
    const d = createDemoDraft()
    ;(d.nodes[1].params as { presetId?: string }).presetId = 'auditor'
    const rhai = compileToRhai(d, {
      presets: {
        auditor: {
          capability: 'read-only',
          isolation: true,
          outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
          disabledTools: ['web_search', 'Name:shell'],
          permissionRules: ['edit:**/.env', 'web_*'],
        },
      },
    })
    expect(rhai).toContain('capability_mode: "read-only"')
    expect(rhai).toContain('isolation_worktree: true')
    expect(rhai).toContain('output_schema: #{ "type": "object"')
    expect(rhai).toContain('"required": ["ok"]')
    expect(rhai).toContain('disabled_tools: ["web_search", "Name:shell"]')
    expect(rhai).toContain('permission_rules: ["edit:**/.env", "web_*"]')
  })

  it('节点显式 read_only / isolation:false 覆盖 Agent 源', () => {
    const d = createDemoDraft()
    Object.assign(d.nodes[1].params, {
      presetId: 'auditor',
      capability: 'read_only',
      isolation: false,
    })
    const rhai = compileToRhai(d, {
      presets: {
        auditor: { capability: 'all', isolation: true },
      },
    })
    expect(rhai).toContain('capability_mode: "read-only"')
    expect(rhai).toContain('isolation_worktree: false')
    expect(rhai).not.toContain('isolation_worktree: true')
  })

  it('无 capability/isolation/outputSchema/disabledTools/permissionRules 时，不输出这些字段', () => {
    const rhai = compileToRhai(createDemoDraft())
    expect(rhai).not.toContain('capability_mode: "read-only"')
    expect(rhai).not.toContain('isolation_worktree')
    expect(rhai).not.toContain('output_schema:')
    expect(rhai).not.toContain('disabled_tools:')
    expect(rhai).not.toContain('permission_rules:')
  })

  it('Agent 具备 skills 时，将其正确注入到提示词中下发', () => {
    const draft = createDemoDraft()
    ;(draft.nodes[1].params as { presetId?: string }).presetId = 'code-reviewer'
    const rhaiWithPreset = compileToRhai(draft, {
      presets: {
        'code-reviewer': {
          skills: ['git-workflow', 'security-audit'],
        },
      },
    })
    expect(rhaiWithPreset).toContain('【可用技能 (Skills)】：git-workflow, security-audit')
  })

  it('Agent 具备 systemPrompt / description 时，将其正确注入到提示词中下发', () => {
    const draft = createDemoDraft()
    ;(draft.nodes[1].params as { presetId?: string }).presetId = 'security-expert'
    const rhai = compileToRhai(draft, {
      presets: {
        'security-expert': {
          name: '安全专家',
          description: '专项审查安全漏洞',
          systemPrompt: '你是资深安全专家，负责审查所有外部输入与越权漏洞。',
        },
      },
    })
    expect(rhai).toContain('你是资深安全专家，负责审查所有外部输入与越权漏洞。')
  })

  it('草稿含绝对路径时被检测', () => {
    const d = createDemoDraft()
    expect(draftHasAbsolutePath(d)).toBeNull()
    ;(d.nodes[1].params as { prompt?: string }).prompt = 'read C:\\\\Users\\\\me\\\\secret.txt'
    expect(draftHasAbsolutePath(d)).toMatch(/绝对路径/)
  })

  it('正确编译官方原生 parallel() 并发扇出与 join 汇聚节点', () => {
    const draft: FlowDraft = {
      id: 'parallel-flow',
      name: '并行流程',
      description: '并行执行多任务并聚合结果',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'par', type: 'parallel', params: { label: '分发' } },
        { id: 'task1', type: 'agent', params: { label: '任务1', prompt: '执行任务1' } },
        { id: 'task2', type: 'agent', params: { label: '任务2', prompt: '执行任务2' } },
        { id: 'j', type: 'join', params: { label: '聚合', mergeMode: 'merge_json' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'par' },
        { from: 'par', to: 'task1' },
        { from: 'par', to: 'task2' },
        { from: 'task1', to: 'j' },
        { from: 'task2', to: 'j' },
        { from: 'j', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('parallel fan-out (2 branches)')
    expect(rhai).toContain('let par_par_jobs = [];')
    expect(rhai).toContain('par_par_jobs.push(')
    expect(rhai).toContain('let par_par = parallel(par_par_jobs);')
    expect(rhai).toContain('join (mode: merge_json)')
    expect(rhai).toContain('complete(')
  })

  it('正确编译基于 prev.output 的多路条件分支路由 (N-Way Routing)', () => {
    const draft: FlowDraft = {
      id: 'multi-branch-flow',
      name: '多路分支流程',
      description: '基于 Agent output 进行 N 路分流',
      version: '1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      nodes: [
        { id: 's', type: 'start', params: { label: '起点' } },
        { id: 'evaluator', type: 'agent', params: { label: '评审员', prompt: '评估代码' } },
        { id: 'b', type: 'branch', params: { label: '多路分流' } },
        { id: 'pass', type: 'agent', params: { label: '直接发布', prompt: '发布' } },
        { id: 'review', type: 'agent', params: { label: '人工复审', prompt: '复审' } },
        { id: 'reject', type: 'agent', params: { label: '打回修改', prompt: '打回' } },
        { id: 'e', type: 'end', params: {} },
      ],
      edges: [
        { from: 's', to: 'evaluator' },
        { from: 'evaluator', to: 'b' },
        { from: 'b', to: 'pass', label: '通过' },
        { from: 'b', to: 'review', label: '待复审' },
        { from: 'b', to: 'reject', label: '拒绝' },
        { from: 'pass', to: 'e' },
        { from: 'review', to: 'e' },
        { from: 'reject', to: 'e' },
      ],
    }
    const rhai = compileToRhai(draft)
    expect(rhai).toContain('if (')
    expect(rhai).toContain('.output.branch == "通过"')
    expect(rhai).toContain('.output.contains("通过")')
    expect(rhai).toContain('} else if (')
    expect(rhai).toContain('.output.branch == "待复审"')
    expect(rhai).toContain('.output.branch == "拒绝"')
    expect(rhai).toContain('complete(')
  })
})
