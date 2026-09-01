import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { $scratchCwd } from '../store'
import {
  formatTokenK,
  formatWorkspaceLabel,
  isMacPlatform,
} from './composerFormat'

describe('formatTokenK', () => {
  it('非正数或非有限数显示 0', () => {
    expect(formatTokenK(0)).toBe('0')
    expect(formatTokenK(-3)).toBe('0')
    expect(formatTokenK(Number.NaN)).toBe('0')
    expect(formatTokenK(Number.POSITIVE_INFINITY)).toBe('0')
  })

  it('不到一千原样取整', () => {
    expect(formatTokenK(1)).toBe('1')
    expect(formatTokenK(999)).toBe('999')
    expect(formatTokenK(12.4)).toBe('12')
  })

  it('一千到一万用一位小数 K', () => {
    expect(formatTokenK(1000)).toBe('1.0K')
    expect(formatTokenK(1500)).toBe('1.5K')
    expect(formatTokenK(9999)).toBe('10.0K')
  })

  it('一万到百万用整数 K，再往上用 M', () => {
    expect(formatTokenK(10_000)).toBe('10K')
    expect(formatTokenK(256_000)).toBe('256K')
    expect(formatTokenK(1_500_000)).toBe('1.5M')
  })
})

describe('formatWorkspaceLabel', () => {
  beforeEach(() => {
    $scratchCwd.set('D:/Users/me/.vesprism/scratch')
  })

  it('空路径和闲聊都显示闲聊', () => {
    expect(formatWorkspaceLabel('')).toBe('闲聊')
    expect(formatWorkspaceLabel('D:/Users/me/.vesprism/scratch')).toBe('闲聊')
  })

  it('项目路径保留最后一段的大小写', () => {
    expect(formatWorkspaceLabel('D:\\Work\\MyApp')).toBe('MyApp')
  })
})

describe('isMacPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有 navigator 时不是 Mac', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isMacPlatform()).toBe(false)
  })

  it('Mac / iOS 平台为真，其它为假', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' })
    expect(isMacPlatform()).toBe(true)
    vi.stubGlobal('navigator', { platform: 'iPhone', userAgent: '' })
    expect(isMacPlatform()).toBe(true)
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Mozilla' })
    expect(isMacPlatform()).toBe(false)
  })
})
