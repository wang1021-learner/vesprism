import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types'
import {
  canRetryAssistant,
  isHiddenUserMessage,
  lastAssistantId,
  originUserMessage,
  promptIndexForUserId,
  stickyUserIndex,
  stickyUserPreview,
} from './userMessage'

function msg(
  id: string,
  role: ChatMessage['role'],
  text = '',
): ChatMessage {
  return { id, role, text }
}

describe('isHiddenUserMessage', () => {
  it('短用户话不是隐藏条', () => {
    expect(isHiddenUserMessage('修一下登录')).toBe(false)
  })

  it('子任务派发词隐藏', () => {
    expect(
      isHiddenUserMessage(
        '你是负责前端的子 agent，请根据父任务说明完成组件拆分与样式对齐。',
      ),
    ).toBe(true)
  })
})

describe('prompt / origin / retry', () => {
  const list = [
    msg('u1', 'user', '第一问'),
    msg('a1', 'assistant', '第一答'),
    msg('u2', 'user', '第二问'),
    msg('t1', 'thought', '…'),
    msg('tool1', 'tool', ''),
    msg('a2', 'assistant', '第二答'),
  ]

  it('origin 取助手前最近提问', () => {
    expect(originUserMessage(list, 'a2')?.id).toBe('u2')
    expect(promptIndexForUserId(list, 'u2')).toBe(1)
  })

  it('仅最新助手且不在生成时可重试', () => {
    expect(lastAssistantId(list)).toBe('a2')
    expect(canRetryAssistant(list, 'a2', false)).toBe(true)
    expect(canRetryAssistant(list, 'a2', true)).toBe(false)
    expect(canRetryAssistant(list, 'a1', false)).toBe(false)
  })

  it('助手后再发用户条则不可重试旧回复', () => {
    const next = [...list, msg('u3', 'user', '第三问')]
    expect(canRetryAssistant(next, 'a2', false)).toBe(false)
  })
})

describe('stickyUserIndex', () => {
  const list = [
    msg('u1', 'user', '问1'),
    msg('a1', 'assistant', '答1'),
    msg('u2', 'user', '问2'),
    msg('tool', 'tool', ''),
    msg('a2', 'assistant', '答2'),
  ]

  it('视口还在提问上则不钉', () => {
    expect(stickyUserIndex(list, 2)).toBe(-1)
  })

  it('视口落到工具/回答时钉住本轮提问', () => {
    expect(stickyUserIndex(list, 3)).toBe(2)
    expect(stickyUserIndex(list, 4)).toBe(2)
  })

  it('顶在列表头不钉', () => {
    expect(stickyUserIndex(list, 0)).toBe(-1)
  })
})

describe('stickyUserPreview', () => {
  it('空白压缩并截断', () => {
    expect(stickyUserPreview('a\n\nb', 10)).toBe('a b')
    expect(stickyUserPreview('x'.repeat(20), 8)).toBe('xxxxxxx…')
  })
})
