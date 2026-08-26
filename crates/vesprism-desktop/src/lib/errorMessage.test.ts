import { describe, expect, it } from 'vitest'
import { formatEngineError, isSessionDeadError } from './errorMessage'

describe('formatEngineError', () => {
  it('空和 Unknown error 换成短句', () => {
    expect(formatEngineError('')).toBe('出了点问题，请重试')
    expect(formatEngineError('Unknown error')).toBe('出了点问题，请重试')
    expect(formatEngineError('Error: Unknown error')).toBe('出了点问题，请重试')
  })

  it('鉴权 / 限流 / 网络', () => {
    expect(formatEngineError('401 Unauthorized')).toContain('鉴权')
    expect(formatEngineError('invalid API key')).toContain('密钥')
    expect(formatEngineError('429 rate limit')).toContain('频繁')
    expect(formatEngineError('error sending request for url: connect ECONNREFUSED')).toContain(
      '连不上',
    )
  })

  it('会话通道和断开', () => {
    expect(formatEngineError('Supervisor 线程已退出')).toContain('重试')
    expect(formatEngineError('会话未启动')).toContain('就绪')
    expect(formatEngineError('会话已断开，自动恢复失败')).toContain('重试')
  })

  it('已是中文的引擎句尽量保留', () => {
    expect(formatEngineError('拒绝访问：目标文件不在当前工作区范围内')).toContain('工作区')
  })
})

describe('isSessionDeadError', () => {
  it('崩溃断开要重试', () => {
    expect(isSessionDeadError('会话已断开，自动恢复失败。请点「重试」或新建对话')).toBe(
      true,
    )
    expect(isSessionDeadError('鉴权失败，请到设置检查密钥')).toBe(false)
  })
})
