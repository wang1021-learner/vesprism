import { describe, expect, it } from 'vitest'
import { formatSandboxDisplayPath } from './sandboxPath'

describe('formatSandboxDisplayPath', () => {
  it('Windows 绝对路径收成 ~ 形式', () => {
    expect(
      formatSandboxDisplayPath('C:\\Users\\me\\.vesprism\\sandboxes\\tab-1'),
    ).toBe('~/.vesprism/sandboxes/tab-1')
  })
  it('已是 posix 的同样处理', () => {
    expect(formatSandboxDisplayPath('/home/u/.vesprism/sandboxes/tab-2')).toBe(
      '~/.vesprism/sandboxes/tab-2',
    )
  })
})
