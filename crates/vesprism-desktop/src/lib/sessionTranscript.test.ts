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

  it('极短思考夹在正文中间时，正文合并、噪声思考不残留', () => {
    let msgs: ChatMessage[] = []
    msgs = applyTranscriptEvent(msgs, { type: 'agent_text_chunk', text: '第一段' })
    // 空思考
    msgs = applyTranscriptEvent(msgs, { type: 'agent_thought_chunk', text: '   ' })
    msgs = applyTranscriptEvent(msgs, { type: 'agent_text_chunk', text: '第二段' })
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(msgs.find((m) => m.role === 'assistant')?.text).toBe('第一段第二段')

    // 极短已结束的思考 + 再来正文
    msgs = [
      {
        id: 'a1',
        role: 'assistant',
        text: '前',
        isStreaming: false,
      },
      {
        id: 't1',
        role: 'thought',
        text: 'x',
        isStreaming: false,
        thoughtTiming: { start: 1000, end: 1100 },
      },
    ]
    msgs = applyTranscriptEvent(msgs, { type: 'agent_text_chunk', text: '后' })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].text).toBe('前后')
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

  it('画布说明书回显不覆盖乐观原话', () => {
    const optimistic = user('分析 src/auth/', 'p_wrap')
    const wrapped =
      '你是这个流程画布的编排助手（第二主聊天）。\n用户：分析 src/auth/'
    const msgs = applyTranscriptEvent([optimistic], {
      type: 'user_text_chunk',
      text: wrapped,
      prompt_id: 'p_wrap',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('分析 src/auth/')
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

  it('不把还在跑的子 agent 行定稿成 completed', () => {
    const msgs = [
      assistant('父回复', true),
      {
        id: 'sa_msg',
        role: 'tool' as const,
        text: '子任务',
        toolCallId: 'subagent_sa_1',
        isStreaming: true,
        toolCall: {
          toolCallId: 'subagent_sa_1',
          kind: 'subagent',
          status: 'in_progress',
          title: '子任务 · 调研 · 运行中',
          detail: 'child_1',
          preview: '',
          timing: { start: Date.now() - 1000 },
        },
      },
    ]
    const sealed = sealStreamingMessages(msgs)
    expect(sealed[0].isStreaming).toBeFalsy()
    expect(sealed[1].isStreaming).toBe(true)
    expect(sealed[1].toolCall?.status).toBe('in_progress')
    expect(sealed[1].toolCall?.timing?.end).toBeUndefined()
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


// ── 中断后立刻发送：旧回合 turn_ended 迟到不得误伤新回合 ──

function msg(id: string, role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, text, ...extra }
}

describe('回合归属 seal（中断后立刻发送的竞态）', () => {
  it('旧回合 turn_ended 只 seal 旧区，新回合流式行保持流式', () => {
    const msgs: ChatMessage[] = [
      msg('u1', 'user', '第一轮问题', { promptId: 'p-A' }),
      msg('a1', 'assistant', '第一轮回复中', { isStreaming: true }),
      msg('u2', 'user', '中断后立刻发的新消息', { promptId: 'p-B' }),
      msg('a2', 'assistant', '新回合回复中', { isStreaming: true }),
    ]
    // 旧回合（p-A）的迟到 turn_ended
    const next = sealStreamingMessages(msgs, 'p-A')
    // 旧区 a1 被定稿
    expect(next[1].isStreaming).toBe(false)
    // 新回合 a2 保持流式（不被误 seal）
    expect(next[3].isStreaming).toBe(true)
  })

  it('正常 turn_ended（prompt_id 匹配最后一条 user）全部定稿', () => {
    const msgs: ChatMessage[] = [
      msg('u1', 'user', '问题', { promptId: 'p-A' }),
      msg('a1', 'assistant', '回复中', { isStreaming: true }),
    ]
    const next = sealStreamingMessages(msgs, 'p-A')
    expect(next[1].isStreaming).toBe(false)
  })

  it('无 prompt_id 兜底：全部定稿（旧行为）', () => {
    const msgs: ChatMessage[] = [
      msg('u1', 'user', '问题', { promptId: 'p-A' }),
      msg('a1', 'assistant', '回复中', { isStreaming: true }),
      msg('a2', 'assistant', '新回复中', { isStreaming: true }),
    ]
    const next = sealStreamingMessages(msgs, null)
    expect(next.every((m) => m.role !== 'assistant' || !m.isStreaming)).toBe(true)
  })
})

// ── todo_write 清单透传（patchTool 保留并实时更新） ──

describe('todo_write 清单透传', () => {
  it('tool_call_update 带 todo → toolCall.todo 写入', () => {
    const msgs: ChatMessage[] = []
    const next = applyTranscriptEvent(msgs, {
      type: 'tool_call_update',
      update: {
        tool_call_id: 'tc-1',
        kind: 'other',
        status: 'in_progress',
        title: 'todo_write',
        todo: {
          summary: '计划',
          todos: [
            { content: '第一步', status: 'pending' },
            { content: '第二步', status: 'completed' },
          ],
        },
      },
    })
    expect(next[0].toolCall?.todo?.todos).toHaveLength(2)
  })

  it('后续 update 实时更新勾选状态（pending → completed）', () => {
    const base = applyTranscriptEvent([], {
      type: 'tool_call_update',
      update: {
        tool_call_id: 'tc-1',
        kind: 'other',
        status: 'in_progress',
        title: 'todo_write',
        todo: {
          summary: '',
          todos: [{ content: '第一步', status: 'in_progress' }],
        },
      },
    })
    const next = applyTranscriptEvent(base, {
      type: 'tool_call_update',
      update: {
        tool_call_id: 'tc-1',
        kind: 'other',
        status: 'completed',
        todo: {
          summary: '',
          todos: [{ content: '第一步', status: 'completed' }],
        },
      },
    })
    expect(next[0].toolCall?.todo?.todos[0].status).toBe('completed')
    expect(next[0].toolCall?.status).toBe('completed')
  })
})
