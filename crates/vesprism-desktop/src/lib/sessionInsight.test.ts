import { describe, expect, it } from 'vitest'
import {
  contextBarParts,
  exportTranscriptMarkdown,
  formatTokens,
  formatUsdTicks,
  parseSessionInfo,
  parseSessionUsage,
} from './sessionInsight'

describe('parseSessionInfo', () => {
  it('读 camelCase 官方 session/info', () => {
    const v = parseSessionInfo({
      sessionId: 's1',
      cwd: '/repo',
      model: 'grok-build',
      modelDisplayName: 'Grok Build',
      turns: 4,
      context: {
        used: 12000,
        total: 100000,
        systemPromptTokens: 2000,
        messageTokens: 8000,
        freeTokens: 88000,
        usagePct: 12,
        autoCompactThresholdPercent: 85,
        turnCount: 4,
        toolCallCount: 9,
        compactionCount: 1,
        usageCategories: [{ label: 'Skills', tokens: 400, detail: '3 skills' }],
      },
    })
    expect(v?.sessionId).toBe('s1')
    expect(v?.context.autoCompactAt).toBe(85)
    expect(v?.context.categories[0].label).toBe('Skills')
    expect(contextBarParts(v!.context).free).toBeGreaterThan(50)
  })
})

describe('parseSessionUsage', () => {
  it('读 totals + modelUsage', () => {
    const v = parseSessionUsage({
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        modelCalls: 2,
        costUsdTicks: 1e10,
        modelUsage: { 'grok-build': { inputTokens: 100, outputTokens: 20 } },
      },
    })
    expect(v?.totals.modelCalls).toBe(2)
    expect(v?.byModel).toHaveLength(1)
    expect(formatUsdTicks(v!.totals.costUsdTicks)).toBe('$1.00')
  })
})

describe('formatTokens', () => {
  it('K / M', () => {
    expect(formatTokens(800)).toBe('800')
    expect(formatTokens(12000)).toBe('12K')
  })
})

describe('exportTranscriptMarkdown', () => {
  it('导出用户与助手', () => {
    const md = exportTranscriptMarkdown([
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '好的' },
    ])
    expect(md).toContain('## 你')
    expect(md).toContain('你好')
    expect(md).toContain('## 助手')
  })
})
