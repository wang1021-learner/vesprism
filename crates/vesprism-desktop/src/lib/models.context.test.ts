import { describe, expect, it } from 'vitest'
import { applyVendorTemplate } from './modelTemplates'
import {
  formatContextTokens,
  isValidEnvKeyName,
  modelSetupWarnings,
  parseContextWindowInput,
  resolveDefaultModelId,
} from './models'

describe('parseContextWindowInput', () => {
  it('128K / 1M / 带逗号的 token 数', () => {
    expect(parseContextWindowInput('128K')).toBe(128_000)
    expect(parseContextWindowInput('1M')).toBe(1_000_000)
    expect(parseContextWindowInput('128,000')).toBe(128_000)
  })

  it('小于 10000 的纯数字当 K，避免和旧栏冲突', () => {
    expect(parseContextWindowInput('128')).toBe(128_000)
  })

  it('粘贴 128000 不再乘一千', () => {
    expect(parseContextWindowInput('128000')).toBe(128_000)
  })
})

describe('formatContextTokens', () => {
  it('整千用 K/M', () => {
    expect(formatContextTokens(128_000)).toBe('128K tokens')
    expect(formatContextTokens(1_000_000)).toBe('1M tokens')
  })
})

describe('resolveDefaultModelId', () => {
  it('编辑其它条目时不改已设默认', () => {
    expect(resolveDefaultModelId('a', 'b', ['a', 'b'])).toBe('a')
  })

  it('默认失效时退到选中项', () => {
    expect(resolveDefaultModelId('gone', 'b', ['a', 'b'])).toBe('b')
  })
})

describe('modelSetupWarnings', () => {
  it('DeepSeek 加了 /v1 要提示', () => {
    const m = applyVendorTemplate('ds', 'deepseek')
    m.base_url = 'https://api.deepseek.com/v1'
    expect(modelSetupWarnings(m).some((x) => x.includes('/v1'))).toBe(true)
  })

  it('官方 DeepSeek 地址不报警', () => {
    const m = applyVendorTemplate('ds', 'deepseek')
    expect(modelSetupWarnings(m)).toEqual([])
  })
})

describe('isValidEnvKeyName', () => {
  it('拒绝空格和数字开头', () => {
    expect(isValidEnvKeyName('DEEPSEEK_API_KEY')).toBe(true)
    expect(isValidEnvKeyName('1KEY')).toBe(false)
    expect(isValidEnvKeyName('A KEY')).toBe(false)
  })
})
