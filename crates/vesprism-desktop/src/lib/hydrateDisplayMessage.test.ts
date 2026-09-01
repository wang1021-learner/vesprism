import { describe, expect, it } from 'vitest'
import { hydrateDisplayMessage } from './hydrateDisplayMessage'

describe('hydrateDisplayMessage', () => {
  it('未知角色当成 assistant，空正文变成空串', () => {
    expect(
      hydrateDisplayMessage({
        id: 'm1',
        role: 'narrator',
        text: '',
      }),
    ).toEqual({
      id: 'm1',
      role: 'assistant',
      text: '',
    })
  })

  it('user / assistant / system / thought 原样保留，并带上可选字段', () => {
    expect(
      hydrateDisplayMessage({
        id: 'm2',
        role: 'user',
        text: '你好',
        tool: 'read',
        tool_call_id: 'tc-1',
        prompt_id: 'p-1',
      }),
    ).toEqual({
      id: 'm2',
      role: 'user',
      text: '你好',
      tool: 'read',
      toolCallId: 'tc-1',
      promptId: 'p-1',
    })
  })

  it('tool 角色用磁盘字段填 ToolCall，不再靠标题猜 kind', () => {
    const msg = hydrateDisplayMessage({
      id: 'm3',
      role: 'tool',
      text: 'fallback-text',
      tool: 'Read src/a.ts',
      tool_call_id: 'call-9',
      kind: 'READ',
      status: 'Completed',
      detail: 'src/a.ts',
      preview: 'export const a = 1',
      start_ms: 1000,
      end_ms: 1400,
    })
    expect(msg).toEqual({
      id: 'm3',
      role: 'tool',
      text: 'export const a = 1',
      tool: 'Read src/a.ts',
      toolCallId: 'call-9',
      toolCall: {
        toolCallId: 'call-9',
        kind: 'read',
        status: 'completed',
        title: 'Read src/a.ts',
        detail: 'src/a.ts',
        preview: 'export const a = 1',
        timing: { start: 1000, end: 1400 },
      },
    })
  })

  it('tool 缺 preview 时用 text，缺 start_ms 就没有 timing', () => {
    const msg = hydrateDisplayMessage({
      id: 'm4',
      role: 'tool',
      text: 'only-text',
      tool: null,
      kind: null,
      status: null,
      start_ms: null,
    })
    expect(msg.role).toBe('tool')
    expect(msg.text).toBe('only-text')
    expect(msg.tool).toBe('tool')
    expect(msg.toolCallId).toBe('m4')
    expect(msg.toolCall).toEqual({
      toolCallId: 'm4',
      kind: 'other',
      status: 'completed',
      title: 'tool',
      detail: 'tool',
      preview: 'only-text',
      timing: undefined,
    })
  })

  it('tool 只有 start_ms 时 timing 不带 end', () => {
    const msg = hydrateDisplayMessage({
      id: 'm5',
      role: 'tool',
      text: '',
      start_ms: 50,
    })
    expect(msg.toolCall?.timing).toEqual({ start: 50 })
  })
})
