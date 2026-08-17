import { describe, expect, it } from 'vitest'
import { titleForWindow } from './windowTitle'

describe('titleForWindow', () => {
  it('流程画布不写进窗口标题', () => {
    expect(titleForWindow('你是 Vesprism 流程画布的图生成器。用户用一句话', 'flow-canvas')).toBe('')
  })

  it('普通对话仍用会话标题', () => {
    expect(titleForWindow('修登录页', null)).toBe('修登录页')
  })

  it('Agent 编制不写进窗口标题', () => {
    expect(titleForWindow('随便什么', 'agents')).toBe('')
  })
})
