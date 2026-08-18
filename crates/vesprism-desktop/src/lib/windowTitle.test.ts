import { describe, expect, it } from 'vitest'
import { titleForWindow } from './windowTitle'

describe('titleForWindow', () => {
  it('窗口标题固定 Vesprism，不随会话/面板变化', () => {
    expect(titleForWindow('修登录页', null)).toBe('')
    expect(titleForWindow('你是 Vesprism 流程画布的图生成器。用户用一句话', 'flow-canvas')).toBe('')
    expect(titleForWindow('随便什么', 'agents')).toBe('')
    expect(titleForWindow('随便什么', 'flow-run')).toBe('')
  })
})
