import { describe, expect, it } from 'vitest'
import {
  FLOW_GENERATE_SYSTEM,
  FLOW_HEAL_MARKER,
  FLOW_PARALLEL_SKELETON,
  buildDialoguePrompt,
  buildHealPrompt,
  canvasContextAnchor,
  isCanvasContractPrimed,
  markCanvasContractPrimed,
  unmarkCanvasContractPrimed,
} from './prompt'
import { validateFlowGraph } from './schema'

describe('buildDialoguePrompt', () => {
  const meta = { name: '鉴权流', id: 'auth-flow' }

  it('首轮带完整契约和用户原话', () => {
    const wire = buildDialoguePrompt('分析 src/auth/', meta)
    expect(wire).toContain('<instructions>')
    expect(wire).toContain('interface FlowGraph')
    expect(wire).toContain('SAME language as the user message')
    expect(wire).toContain('<user_query>\n分析 src/auth/\n</user_query>')
    expect(wire).toContain('auth-flow')
    expect(wire).toContain('no orphans')
  })

  it('已注入后只跟拓扑摘要，不再整份契约', () => {
    const wire = buildDialoguePrompt('把第三个节点改成只读', meta, {
      primed: true,
      nodeIds: ['start-main', 'agent-review', 'end-report'],
    })
    expect(wire).toContain('<user_query>\n把第三个节点改成只读\n</user_query>')
    expect(wire).toContain(canvasContextAnchor(meta, ['start-main', 'agent-review', 'end-report']))
    expect(wire).toContain('Current Topology: start-main  agent-review  end-report')
    expect(wire.includes('interface FlowGraph')).toBe(false)
    expect(wire.includes(FLOW_GENERATE_SYSTEM.slice(0, 24))).toBe(false)
  })

  it('按 session 记住是否已注入', () => {
    expect(isCanvasContractPrimed('sess-prompt-1')).toBe(false)
    markCanvasContractPrimed('sess-prompt-1')
    expect(isCanvasContractPrimed('sess-prompt-1')).toBe(true)
    expect(isCanvasContractPrimed('sess-other')).toBe(false)
    unmarkCanvasContractPrimed('sess-prompt-1')
    expect(isCanvasContractPrimed('sess-prompt-1')).toBe(false)
  })

  it('契约含语义 id 规则和合法并行骨架', () => {
    expect(FLOW_GENERATE_SYSTEM).toContain('agent-code-reviewer')
    expect(FLOW_GENERATE_SYSTEM).toContain('start-main')
    expect(validateFlowGraph(FLOW_PARALLEL_SKELETON).ok).toBe(true)
    expect(buildHealPrompt('join 至少需要 2 条输入边')).toContain(FLOW_HEAL_MARKER)
    expect(buildHealPrompt('join 至少需要 2 条输入边')).toContain('join 至少需要 2 条输入边')
  })
})
