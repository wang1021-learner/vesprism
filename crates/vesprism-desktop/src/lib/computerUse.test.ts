import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_UNSUPPORTED,
  computerUseBlockedReason,
  computerUseMenuSub,
  computerUsePlatformHint,
} from './computerUse'

describe('computerUseBlockedReason', () => {
  it('支持的系统可开可关', () => {
    expect(computerUseBlockedReason(true, true)).toBeNull()
    expect(computerUseBlockedReason(false, true)).toBeNull()
  })

  it('不支持的系统不能开，可以关', () => {
    expect(computerUseBlockedReason(true, false)).toBe(COMPUTER_USE_UNSUPPORTED)
    expect(computerUseBlockedReason(false, false)).toBeNull()
  })
})

describe('computerUseMenuSub', () => {
  it('不支持时入口写明不可用', () => {
    expect(computerUseMenuSub(false)).toContain('不可用')
    expect(computerUseMenuSub(true)).toContain('设置')
  })
})

describe('computerUsePlatformHint', () => {
  it('macOS / Linux 补权限或依赖说明', () => {
    expect(computerUsePlatformHint('macos')).toContain('辅助功能')
    expect(computerUsePlatformHint('linux')).toContain('xdotool')
    expect(computerUsePlatformHint('windows')).toBeNull()
  })
})
