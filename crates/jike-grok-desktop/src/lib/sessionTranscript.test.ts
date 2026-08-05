/**
 * transcript：ask_user 工具卡插入 / 解答
 */
import { describe, expect, it } from 'vitest'
import {
  applyTranscriptEvent,
  formatAskUserAnswerPreview,
  formatAskUserDetail,
} from './sessionTranscript'
import type { ChatMessage } from '../types'

describe('applyTranscriptEvent ask_user', () => {
  it('user_question_request 写入 ask_user 工具卡', () => {
    const msgs = applyTranscriptEvent([], {
      type: 'user_question_request',
      tool_call_id: 'ask_tc',
      request_id: 3,
      questions: [
        {
          question: '用哪种数据库？',
          options: [
            { label: 'Postgres', description: '关系型' },
            { label: 'Redis', description: '缓存' },
          ],
        },
      ],
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    expect(msgs[0].toolCall?.kind).toBe('ask_user')
    expect(msgs[0].toolCall?.toolCallId).toBe('ask_tc')
    expect(msgs[0].toolCall?.detail).toContain('数据库')
  })

  it('user_question_resolved 回写答案预览', () => {
    let msgs: ChatMessage[] = applyTranscriptEvent([], {
      type: 'user_question_request',
      tool_call_id: 'ask_tc',
      questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
    })
    msgs = applyTranscriptEvent(msgs, {
      type: 'user_question_resolved',
      tool_call_id: 'ask_tc',
      outcome: 'accepted',
      answer_preview: 'Q? → A',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].toolCall?.status).toBe('completed')
    expect(msgs[0].toolCall?.preview).toBe('Q? → A')
  })

  it('format helpers', () => {
    expect(formatAskUserDetail([{ question: 'Hello' }])).toContain('Hello')
    expect(formatAskUserAnswerPreview('cancelled')).toMatch(/跳过|取消|declin/i)
  })
})
