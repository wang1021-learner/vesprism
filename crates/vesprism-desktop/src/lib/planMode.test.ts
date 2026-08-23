import { describe, expect, it } from 'vitest'
import {
  applyModeUpdate,
  EMPTY_PLAN_PLACEHOLDER,
  formatPlanComments,
  formatPlanFeedback,
  markPlanActivated,
  planChipLabel,
  planPreviewBody,
} from './planMode'

describe('planChipLabel', () => {
  it('关 / 待发 / 开 / 等你批', () => {
    expect(planChipLabel('off', false).label).toBe('计划')
    expect(planChipLabel('off', false).on).toBe(false)
    expect(planChipLabel('pending', false).label).toBe('计划 · 下条生效')
    expect(planChipLabel('active', false).on).toBe(true)
    expect(planChipLabel('active', true).label).toBe('计划 · 等你批')
    expect(planChipLabel('exit_pending', false).label).toBe('计划 · 本轮后关')
  })
})

describe('applyModeUpdate', () => {
  it('pending 不被 CurrentModeUpdate(plan) 提前变成 active', () => {
    expect(applyModeUpdate('plan', 'pending')).toBe('pending')
  })
  it('关着时收到 plan 视为模型自己进了计划模式', () => {
    expect(applyModeUpdate('plan', 'off')).toBe('active')
  })
  it('default 一律关掉', () => {
    expect(applyModeUpdate('default', 'active')).toBe('off')
    expect(applyModeUpdate('default', 'pending')).toBe('off')
    expect(applyModeUpdate('ask', 'active')).toBe('off')
  })
  it('exit_pending 等到 default 才关', () => {
    expect(applyModeUpdate('plan', 'exit_pending')).toBe('exit_pending')
    expect(applyModeUpdate('default', 'exit_pending')).toBe('off')
  })
})

describe('markPlanActivated', () => {
  it('只把 pending 推进到 active', () => {
    expect(markPlanActivated('pending')).toBe('active')
    expect(markPlanActivated('active')).toBe('active')
    expect(markPlanActivated('off')).toBe('off')
  })
})

describe('formatPlanComments', () => {
  const plan = '# Plan\n\n## Step 1\nDo auth\nDo tests'
  it('单行', () => {
    const text = formatPlanComments(
      [{ id: '1', startLine: 4, endLine: 4, text: '路径写错' }],
      plan,
    )
    expect(text).toContain('Proposed plan line 4:')
    expect(text).toContain('> Do auth')
    expect(text).toContain('Comment:\n路径写错')
  })
  it('多行含两端', () => {
    const text = formatPlanComments(
      [{ id: '1', startLine: 4, endLine: 5, text: '一起改' }],
      plan,
    )
    expect(text).toContain('Proposed plan lines 4-5:')
    expect(text).toContain('> Do auth')
    expect(text).toContain('> Do tests')
  })
})

describe('formatPlanFeedback', () => {
  it('只有总意见', () => {
    expect(formatPlanFeedback([], '# x', '  用 JWT  ')).toBe('用 JWT')
  })
  it('批注加总意见', () => {
    const text = formatPlanFeedback(
      [{ id: '1', startLine: 1, endLine: 1, text: '标题改短' }],
      '# Hello',
      '另外补验证',
    )
    expect(text).toContain('Comment:\n标题改短')
    expect(text).toContain('Additional feedback:\n另外补验证')
  })
  it('空回车不算意见', () => {
    expect(formatPlanFeedback([], 'x', '   ')).toBe('')
  })
})

describe('planPreviewBody', () => {
  it('空稿用占位文案', () => {
    expect(planPreviewBody('', false)).toBe(EMPTY_PLAN_PLACEHOLDER)
    expect(planPreviewBody('   ', true)).toBe(EMPTY_PLAN_PLACEHOLDER)
  })
  it('有稿用原文', () => {
    expect(planPreviewBody('# 做法', true)).toBe('# 做法')
  })
})
