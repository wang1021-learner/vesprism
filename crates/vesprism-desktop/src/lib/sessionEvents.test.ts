/**
 * turn_ended：队列空必须显式 idle，避免后端漏发 status_changed 时取消按钮卡住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bridge', () => ({
  loadSession: vi.fn(),
  respondPermission: vi.fn(),
  respondExitPlanMode: vi.fn(),
  setCurrentModel: vi.fn(),
  startSession: vi.fn(),
  sessionCaps: vi.fn().mockResolvedValue({
    recap: true,
    askMode: true,
    memory: true,
    hunks: true,
    rewind: true,
    gitWrite: true,
    imagine: true,
    schedule: true,
    queueEdit: true,
    plugins: true,
    hooks: true,
    compact: true,
  }),
}))

import { handleSessionEvent } from './sessionEvents'
import { createTab, getTabState, patchTab, resetTabsForTests } from '../store'

beforeEach(() => {
  resetTabsForTests()
  createTab('tab-1', {
    status: 'generating',
    permission: { requestId: 1, command: 'ls' } as never,
    messages: [{ id: 'm1', role: 'user', text: 'hi', promptId: 'p1' } as never],
  })
})

describe('turn_ended status', () => {
  it('队列空：本轮结束置 idle，并清权限条', () => {
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    const st = getTabState('tab-1')
    expect(st?.status).toBe('idle')
    expect(st?.permission).toBeNull()
  })

  it('队列还有货：保持 generating', () => {
    patchTab('tab-1', {
      queuedPrompts: [{ id: 'p2', version: 0, text: 'next', position: 0 }],
    })
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    expect(getTabState('tab-1')?.status).toBe('generating')
  })

  it('画布 Tab 的 title_changed 洗成用户原话，与侧栏一致', () => {
    resetTabsForTests()
    createTab('tab-flow', {
      utilityKind: 'flow-canvas',
      chatTitle: '流程画布',
    })
    handleSessionEvent({
      tab_id: 'tab-flow',
      type: 'title_changed',
      title:
        '<user_query>\n<instructions>\nYou are the Vesprism flow-canvas orchestrator\n</instructions>\n<user_query>\n你根据他的agent配置一个agent\n</user_query>\n</user_query>',
    })
    expect(getTabState('tab-flow')?.chatTitle).toBe('你根据他的agent配置一个agent')
  })

  it('迟到的旧回合：不改下一轮状态和权限条', () => {
    patchTab('tab-1', {
      status: 'generating',
      permission: { requestId: 9, command: 'pwd' } as never,
      messages: [
        { id: 'm1', role: 'user', text: 'old', promptId: 'p1' } as never,
        { id: 'm2', role: 'user', text: 'new', promptId: 'p2' } as never,
      ],
    })
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    const st = getTabState('tab-1')
    expect(st?.status).toBe('generating')
    expect(st?.permission).not.toBeNull()
  })

  it('计划模式 CurrentModeUpdate 写入 planPhase', () => {
    handleSessionEvent({ tab_id: 'tab-1', type: 'current_mode_update', mode_id: 'plan' })
    expect(getTabState('tab-1')?.planPhase).toBe('active')
    handleSessionEvent({ tab_id: 'tab-1', type: 'current_mode_update', mode_id: 'default' })
    expect(getTabState('tab-1')?.planPhase).toBe('off')
  })

  it('exit_plan_mode_request 挂起审批卡且不清 turn_ended', () => {
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'exit_plan_mode_request',
      request_id: 7,
      tool_call_id: 'tc-plan',
      plan_content: '# 做法\n改芯片',
    })
    const st = getTabState('tab-1')
    expect(st?.planApproval?.requestId).toBe(7)
    expect(st?.planPreviewOpen).toBe(true)
    expect(st?.lastPlanHasBody).toBe(true)
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended', prompt_id: 'p1' })
    expect(getTabState('tab-1')?.planApproval?.requestId).toBe(7)
  })

  it('recap 写入 lastRecap；ask 模式落到 sessionMode', () => {
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'recap',
      summary: '刚才在改登录',
      auto: false,
    })
    expect(getTabState('tab-1')?.lastRecap).toEqual({
      summary: '刚才在改登录',
      auto: false,
    })
    handleSessionEvent({ tab_id: 'tab-1', type: 'current_mode_update', mode_id: 'ask' })
    expect(getTabState('tab-1')?.sessionMode).toBe('ask')
    expect(getTabState('tab-1')?.planPhase).toBe('off')
  })

  it('scheduled_task 创建写入本 tab，删除清掉', () => {
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'scheduled_task',
      op: 'created',
      task_id: 'loop-1',
      prompt: '检查部署',
      human_schedule: 'every 5 minutes',
      next_fire_at: '2030-01-01T00:00:00Z',
    })
    expect(getTabState('tab-1')?.scheduledTasks).toEqual([
      expect.objectContaining({
        taskId: 'loop-1',
        prompt: '检查部署',
        pending: false,
      }),
    ])
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'scheduled_task',
      op: 'deleted',
      task_id: 'loop-1',
      reason: 'expired',
    })
    expect(getTabState('tab-1')?.scheduledTasks).toEqual([])
  })

  it('取消产生的无 prompt_id 迟到 turn_ended：不误杀新发出的 generating 状态', () => {
    patchTab('tab-1', {
      status: 'generating',
      permission: null,
      messages: [
        { id: 'm2', role: 'user', text: 'new question', promptId: 'p_new' } as never,
      ],
    })
    handleSessionEvent({ tab_id: 'tab-1', type: 'turn_ended' })
    const st = getTabState('tab-1')
    expect(st?.status).toBe('generating')
  })

  it('上下文超限写入会话横幅并置 idle', () => {
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'context_overflow',
      message: 'too long',
    })
    const st = getTabState('tab-1')
    expect(st?.status).toBe('idle')
    expect(st?.sessionAlert).toEqual({ kind: 'overflow', message: 'too long' })
  })

  it('限流与鉴权过期各写一种横幅', () => {
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'rate_limit_exceeded',
      message: 'slow down',
    })
    expect(getTabState('tab-1')?.sessionAlert?.kind).toBe('rate')
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'auth_expired',
      message: 'login',
    })
    expect(getTabState('tab-1')?.sessionAlert).toEqual({
      kind: 'auth',
      message: 'login',
    })
  })
})

describe('崩溃恢复与错误提示', () => {
  it('切工作区 restarting 时忽略 reconnecting，不当成恢复旧对话', async () => {
    const { startSession } = await import('../bridge')
    vi.mocked(startSession).mockClear()
    patchTab('tab-1', { phase: 'restarting', sessionId: '', cwd: 'D:\\proj' })
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'session_reconnecting',
      attempt: 1,
    })
    await Promise.resolve()
    expect(startSession).not.toHaveBeenCalled()
    expect(getTabState('tab-1')?.phase).toBe('restarting')
  })

  it('tab_failed 写人话、标 failed、清挂起权限', () => {
    handleSessionEvent({ tab_id: 'tab-1', type: 'tab_failed', attempts: 3 })
    const st = getTabState('tab-1')
    expect(st?.phase).toBe('failed')
    expect(st?.error).toContain('连续崩溃')
    expect(st?.permission).toBeNull()
    expect(st?.status).toBe('idle')
  })

  it('error Unknown error 换成短句', () => {
    handleSessionEvent({ tab_id: 'tab-1', type: 'error', message: 'Unknown error' })
    expect(getTabState('tab-1')?.error).toBe('出了点问题，请重试')
    expect(getTabState('tab-1')?.status).toBe('idle')
  })

  it('会话断开失败标 failed 以便点重试', () => {
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'error',
      message: '会话已断开，自动恢复失败',
    })
    expect(getTabState('tab-1')?.phase).toBe('failed')
    expect(getTabState('tab-1')?.error).toContain('重试')
  })
})
