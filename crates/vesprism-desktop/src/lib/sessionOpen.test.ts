import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── hoisted 共享状态（vi.mock 工厂是 hoisted 的，不能引用普通外部变量）──
const { storeMsgs, mocks } = vi.hoisted(() => {
  // 注意：storeMsgs 用「替换」语义（let + 赋值新数组），不能就地 push——
  // vi.fn 的 mock.calls 存参数引用，就地修改会让断言时读到被改过的内容。
  let storeMsgs: unknown[] = []
  return {
    storeMsgs: {
      get: () => storeMsgs,
      set: (m: unknown[]) => {
        storeMsgs = m
      },
    },
    mocks: {
      patchTab: vi.fn(),
      applyTranscriptEvent: vi.fn((cur: unknown[], ev: unknown) => [...cur, ev]),
      sealStreamingMessages: vi.fn((cur: unknown[]) => [...cur, { sealed: true }]),
    },
  }
})

vi.mock('../store', () => ({
  $activeTabId: { get: () => 'tab-1' },
  $messages: {
    get: () => storeMsgs.get(),
    set: (m: unknown[]) => storeMsgs.set(m),
  },
  getTabState: () => ({ messages: storeMsgs.get(), backgroundTasks: {} }),
  patchTab: (_id: string, patch: { messages?: unknown[] }) => {
    mocks.patchTab(_id, patch)
    if (patch.messages) storeMsgs.set(patch.messages)
  },
}))

vi.mock('./sessionTranscript', () => ({
  applyTranscriptEvent: (cur: unknown[], ev: unknown, _bgs?: unknown) =>
    mocks.applyTranscriptEvent(cur, ev),
  sealStreamingMessages: (cur: unknown[], _promptId?: unknown, _bgs?: unknown) =>
    mocks.sealStreamingMessages(cur),
}))

import * as open from './sessionOpen'

const chunk = (text: string) => ({ type: 'agent_text_chunk', text, prompt_id: 'p' })

let rafCb: FrameRequestCallback | null = null

beforeEach(() => {
  storeMsgs.set([])
  vi.clearAllMocks()
  rafCb = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('setTimeout', () => 1)
  vi.stubGlobal('clearTimeout', vi.fn())
})

function flushFrame(): void {
  const cb = rafCb
  rafCb = null
  cb?.(0)
}

describe('rAF 攒批（sessionOpen）', () => {
  it('高频文本 chunk 攒批：rAF 触发前不提交，帧边界一次合并提交', () => {
    open.pushTranscriptEvent(chunk('a'), 'tab-1')
    open.pushTranscriptEvent(chunk('b'), 'tab-1')
    open.pushTranscriptEvent(chunk('c'), 'tab-1')
    // 未到帧边界：store 未提交
    expect(mocks.patchTab).not.toHaveBeenCalled()
    expect(storeMsgs.get()).toHaveLength(0)
    // 帧边界 flush：一次提交，三个 chunk 全部落盘
    flushFrame()
    expect(mocks.patchTab).toHaveBeenCalledTimes(1)
    expect(storeMsgs.get()).toHaveLength(3)
    // applyTranscriptEvent 按序各调用一次
    expect(mocks.applyTranscriptEvent).toHaveBeenCalledTimes(3)
  })

  it('turn_ended 前先 flush 攒批文本（保序，seal 不丢文本）', () => {
    open.pushTranscriptEvent(chunk('x'), 'tab-1')
    const ret = open.pushTranscriptEvent({ type: 'turn_ended', prompt_id: 'p' }, 'tab-1')
    expect(ret).toBe(false)
    // chunk 先落盘，再 seal——顺序正确，文本不丢
    expect(mocks.applyTranscriptEvent).toHaveBeenCalledTimes(1)
    expect(mocks.sealStreamingMessages).toHaveBeenCalledTimes(1)
    expect(storeMsgs.get()).toEqual([{ type: 'agent_text_chunk', text: 'x', prompt_id: 'p' }, { sealed: true }])
  })

  it('tool_call 前 flush 攒批文本，flush 后重读 store 不覆盖', () => {
    open.pushTranscriptEvent(chunk('y'), 'tab-1')
    open.pushTranscriptEvent({ type: 'tool_call', tool: { name: 'bash' } }, 'tab-1')
    // 顺序：chunk 应用（在空 store 上）→ tool_call 应用（在含 chunk 的 store 上）
    expect(mocks.applyTranscriptEvent).toHaveBeenNthCalledWith(1, [], chunk('y'))
    expect(mocks.applyTranscriptEvent).toHaveBeenNthCalledWith(2, [chunk('y')], { type: 'tool_call', tool: { name: 'bash' } })
    expect(storeMsgs.get()).toHaveLength(2)
  })

  it('attach 期间 chunk 照旧丢弃', () => {
    // beginAttachRuntime 自身会 patchTab（phase/status），先清掉再验证 chunk 不提交。
    open.beginAttachRuntime('tab-1')
    mocks.patchTab.mockClear()
    open.pushTranscriptEvent(chunk('z'), 'tab-1')
    flushFrame()
    expect(mocks.patchTab).not.toHaveBeenCalled()
    open.finishAttachRuntime('tab-1')
  })
})
