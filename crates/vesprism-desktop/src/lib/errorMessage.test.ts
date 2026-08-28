import { describe, expect, it } from 'vitest'
import {
  formatEngineError,
  isMissingWorkspacePathError,
  isSessionDeadError,
} from './errorMessage'

describe('formatEngineError', () => {
  it('空和 Unknown error 换成短句', () => {
    expect(formatEngineError('')).toBe('出了点问题，请重试')
    expect(formatEngineError('Unknown error')).toBe('出了点问题，请重试')
    expect(formatEngineError('Error: Unknown error')).toBe('出了点问题，请重试')
  })

  it('鉴权 / 限流 / 网络', () => {
    expect(formatEngineError('401 Unauthorized')).toContain('鉴权')
    expect(formatEngineError('401 Unauthorized')).toContain('登录')
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
    expect(formatEngineError('Cannot rewind to prompt #1 — current prompt index is 1')).toContain(
      '没法重试',
    )
  })

  it('已是中文的引擎句尽量保留', () => {
    expect(formatEngineError('拒绝访问：目标文件不在当前工作区范围内')).toContain('工作区')
  })

  it('历史会话没接上：记录还在，请重试', () => {
    const raw =
      '打开历史会话失败: Path not found.: { "code": "FS_NOT_FOUND", "detail": "系统找不到指定的路径。 (os error 3)" }'
    expect(formatEngineError(raw)).toContain('聊天记录还在')
    expect(formatEngineError(raw)).toContain('重试')
    expect(formatEngineError(raw)).not.toContain('闲聊')
    expect(isMissingWorkspacePathError(raw)).toBe(true)
  })

  it('恢复会话失败也收成同一句，不把英文原文拼上去', () => {
    expect(formatEngineError('恢复会话失败: Path not found.')).toBe(
      '没能接上这条对话。聊天记录还在，请点「重试」。',
    )
  })

  it('分享和反馈的账号限制换成中文', () => {
    expect(formatEngineError('Session sharing is not available for your account.')).toBe(
      '当前账号不能分享会话',
    )
    expect(formatEngineError('Feedback is disabled. To enable, set GROK_FEEDBACK_ENABLED=true')).toContain(
      '反馈未开启',
    )
  })
})

describe('isSessionDeadError', () => {
  it('崩溃断开要重试', () => {
    expect(isSessionDeadError('会话已断开，自动恢复失败。请点「重试」或新建对话')).toBe(
      true,
    )
    expect(
      isSessionDeadError('没能接上这条对话。聊天记录还在，请点「重试」。'),
    ).toBe(true)
    expect(isSessionDeadError('鉴权失败，请到设置检查密钥')).toBe(false)
  })
})
