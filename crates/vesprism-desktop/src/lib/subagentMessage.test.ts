import { describe, expect, it } from 'vitest'
import {
  formatRecentTools,
  formatSubagentHeadline,
  formatSubagentLiveMeta,
  subagentToolCallId,
  upsertSubagentMessage,
} from './subagentMessage'
import type { ChatMessage, SubagentRuntime } from '../types'

const base: SubagentRuntime = {
  subagentId: 'sa_1',
  parentSessionId: 'p',
  childSessionId: 'child_1',
  subagentType: 'general-purpose',
  description: '背诵三字经',
  status: 'running',
}

describe('upsertSubagentMessage', () => {
  it('插入子任务 scaffold 行', () => {
    const msgs = upsertSubagentMessage([], base)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    expect(msgs[0].toolCall?.kind).toBe('subagent')
    expect(msgs[0].toolCallId).toBe(subagentToolCallId('sa_1'))
    expect(msgs[0].toolCall?.detail).toBe('child_1')
    expect(msgs[0].isStreaming).toBe(true)
  })

  it('进度更新同一行，完成写入 output', () => {
    let msgs: ChatMessage[] = upsertSubagentMessage([], base)
    msgs = upsertSubagentMessage(msgs, {
      ...base,
      status: 'completed',
      turnCount: 1,
      durationMs: 48000,
      output: '人之初，性本善。',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].toolCall?.status).toBe('completed')
    expect(msgs[0].toolCall?.preview).toContain('人之初')
    expect(msgs[0].isStreaming).toBe(false)
    expect(formatSubagentHeadline({ ...base, status: 'completed', turnCount: 1 })).toContain(
      '完成',
    )
  })
})

describe('formatSubagentLiveMeta', () => {
  it('最近工具从尾部去重，优先中文名', () => {
    expect(formatRecentTools(['grep', 'read_file', 'grep'], 3)).toBe(
      '内容搜索, 读取文件',
    )
  })

  it('拼耗时、轮次、工具；没工具名才写次数', () => {
    expect(
      formatSubagentLiveMeta({
        durationMs: 8000,
        turnCount: 2,
        toolCallCount: 5,
        toolsUsed: ['grep'],
      }),
    ).toBe('8s · 2 轮 · 内容搜索')
    expect(
      formatSubagentLiveMeta({
        durationMs: 1000,
        toolCallCount: 3,
      }),
    ).toBe('1s · 3 次工具')
  })
})
