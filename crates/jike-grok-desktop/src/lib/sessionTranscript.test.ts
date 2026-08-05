/**
 * transcript 合并 + ask_user 问卷卡（共 10 例）
 */
import { describe, expect, it } from 'vitest'
import {
  applyTranscriptEvent,
  formatAcceptedAnswersPreview,
  formatAskUserAnswerPreview,
  removeUserMessageByPromptId,
  sealStreamingMessages,
} from './sessionTranscript'
import type { ChatMessage } from '../types'

function user(text: string, promptId?: string): ChatMessage {
  return {
    id: `u_${text}`,
    role: 'user',
    text,
    ...(promptId ? { promptId } : {}),
  }
}

function assistant(text: string, streaming = false): ChatMessage {
  return {
    id: `a_${text.slice(0, 8)}`,
    role: 'assistant',
    text,
    isStreaming: streaming,
  }
}

describe('applyTranscriptEvent', () => {
  it('assistant 分片追加到同一气泡', () => {
    let msgs: ChatMessage[] = []
    msgs = applyTranscriptEvent(msgs, { type: 'agent_text_chunk', text: '你好' })
    msgs = applyTranscriptEvent(msgs, { type: 'agent_text_chunk', text: '世界' })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].text).toBe('你好世界')
    expect(msgs[0].isStreaming).toBe(true)
  })

  it('user_text_chunk 按 promptId 核销乐观气泡，不插第二条', () => {
    const optimistic = user('完整问题', 'p_abc')
    const msgs = applyTranscriptEvent([optimistic], {
      type: 'user_text_chunk',
      text: '完整问题',
      prompt_id: 'p_abc',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('完整问题')
    expect(msgs[0].promptId).toBe('p_abc')
  })

  it('user_text_chunk 前缀累积更新乐观气泡', () => {
    const optimistic = user('你', 'p_1')
    const msgs = applyTranscriptEvent([optimistic], {
      type: 'user_text_chunk',
      text: '你好',
      prompt_id: 'p_1',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('你好')
  })

  it('tool_call 插入工具行', () => {
    const msgs = applyTranscriptEvent([], {
      type: 'tool_call',
      tool: {
        toolCallId: 'tc_1',
        kind: 'edit',
        status: 'completed',
        title: 'Edit file',
        detail: 'src/a.ts',
        preview: '',
        diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'b' }],
      },
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    expect(msgs[0].toolCall?.toolCallId).toBe('tc_1')
    expect(msgs[0].toolCall?.diffs?.[0].path).toBe('src/a.ts')
  })
})

describe('removeUserMessageByPromptId', () => {
  it('发送失败时撤回对应乐观气泡', () => {
    const msgs = [
      user('keep', 'p_keep'),
      user('drop me', 'p_drop'),
      assistant('hi'),
    ]
    const next = removeUserMessageByPromptId(msgs, 'p_drop')
    expect(next).toHaveLength(2)
    expect(next.map((m) => m.promptId || m.role)).toEqual(['p_keep', 'assistant'])
  })

  it('无匹配时返回原数组引用', () => {
    const msgs = [user('x', 'p_1')]
    const next = removeUserMessageByPromptId(msgs, 'p_missing')
    expect(next).toBe(msgs)
  })
})

describe('sealStreamingMessages', () => {
  it('turn 结束时去掉 isStreaming', () => {
    const msgs = [assistant('done', true)]
    const sealed = sealStreamingMessages(msgs)
    expect(sealed[0].isStreaming).toBeFalsy()
  })
})

describe('ask_user 工具卡', () => {
  it('user_question_request 写入 pending 卡且 detail 为首题', () => {
    const msgs = applyTranscriptEvent([], {
      type: 'user_question_request',
      tool_call_id: 'ask_tc',
      request_id: 3,
      questions: [
        {
          question: '用哪种数据库？',
          options: [
            { label: 'Postgres' },
            { label: 'Redis' },
          ],
        },
      ],
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].toolCall?.kind).toBe('ask_user')
    expect(msgs[0].toolCall?.status).toBe('pending')
    expect(msgs[0].toolCall?.detail).toContain('数据库')
  })

  it('user_question_resolved 写答案预览且保留题目 detail', () => {
    let msgs: ChatMessage[] = applyTranscriptEvent([], {
      type: 'user_question_request',
      tool_call_id: 'ask_tc',
      questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
    })
    const detailBefore = msgs[0].toolCall?.detail
    msgs = applyTranscriptEvent(msgs, {
      type: 'user_question_resolved',
      tool_call_id: 'ask_tc',
      outcome: 'accepted',
      answer_preview: 'Q? → A',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].toolCall?.status).toBe('completed')
    expect(msgs[0].toolCall?.preview).toBe('Q? → A')
    expect(msgs[0].toolCall?.detail).toBe(detailBefore)
  })

  it('formatAskUserAnswerPreview 拼接选项', () => {
    expect(
      formatAskUserAnswerPreview('accepted', {
        '用哪种数据库？': ['Postgres'],
      }),
    ).toContain('Postgres')
    expect(formatAcceptedAnswersPreview({ a: ['1'], b: ['2'] })).toContain('→')
    expect(formatAskUserAnswerPreview('cancelled')).toMatch(/取消/)
  })
})

