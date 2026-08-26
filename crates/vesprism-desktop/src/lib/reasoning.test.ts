import { describe, expect, it } from 'vitest'
import { emptyModelEntry } from './models'
import {
  clampReasoningEffort,
  defaultReasoningEffortFor,
  looksLikeDeepSeek,
  reasoningEffortValuesFor,
  reasoningLevelsFor,
  spawnReasoningEffort,
} from './reasoning'

describe('looksLikeDeepSeek', () => {
  it('认官方 host 和 deepseek- 前缀', () => {
    expect(looksLikeDeepSeek('deepseek-v4-pro', '')).toBe(true)
    expect(looksLikeDeepSeek('x', 'https://api.deepseek.com')).toBe(true)
    expect(looksLikeDeepSeek('grok-4', 'https://api.x.ai/v1')).toBe(false)
  })
})

describe('reasoningEffortValuesFor', () => {
  it('DeepSeek 只有 low/high/max', () => {
    expect(reasoningEffortValuesFor('deepseek-v4-flash', 'https://api.deepseek.com')).toEqual([
      'low',
      'high',
      'max',
    ])
  })

  it('其它模型保留完整档', () => {
    expect(reasoningEffortValuesFor('grok-4', 'https://api.x.ai/v1')).toContain('medium')
    expect(reasoningEffortValuesFor('grok-4', 'https://api.x.ai/v1')).toContain('none')
  })
})

describe('default / clamp', () => {
  it('DeepSeek 空档和 medium 都落到 high', () => {
    expect(defaultReasoningEffortFor('deepseek-v4', 'https://api.deepseek.com', '')).toBe(
      'high',
    )
    expect(clampReasoningEffort('deepseek-v4', 'https://api.deepseek.com', 'medium')).toBe(
      'high',
    )
    expect(clampReasoningEffort('deepseek-v4', 'https://api.deepseek.com', 'low')).toBe('low')
  })

  it('非 DeepSeek 空档是 medium', () => {
    expect(defaultReasoningEffortFor('grok-4', 'https://api.x.ai/v1', '')).toBe('medium')
  })
})

describe('reasoningLevelsFor', () => {
  it('Messages 藏掉 none/minimal', () => {
    const levels = reasoningLevelsFor({
      model: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com/v1',
      apiBackend: 'messages',
    })
    expect(levels.map((l) => l.value)).not.toContain('none')
    expect(levels.map((l) => l.value)).not.toContain('minimal')
  })
})

describe('spawnReasoningEffort', () => {
  it('未声明推理能力时沿用 fallback', () => {
    const m = emptyModelEntry({ id: 'a', model: 'llama3', supports_reasoning_effort: false })
    expect(spawnReasoningEffort(m, 'low')).toBe('low')
    expect(spawnReasoningEffort(m)).toBeUndefined()
  })

  it('DeepSeek 用模型默认 high', () => {
    const m = emptyModelEntry({
      id: 'ds',
      model: 'deepseek-v4-flash',
      base_url: 'https://api.deepseek.com',
      supports_reasoning_effort: true,
      reasoning_effort: '',
    })
    expect(spawnReasoningEffort(m)).toBe('high')
  })
})
