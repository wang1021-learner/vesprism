/**
 * 权限审批事件链路（共 4 例）：
 * 未命中记忆 → 弹审批条；点「仅这场对话允许」→ 下次同命令自动放行（respondPermission + 不弹）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSessionEvent } from './lib/sessionEvents'
import { addSessionAllowed, permissionSignature } from './lib/permissionMemory'
import { clearSessionAllowed } from './lib/permissionMemory'
import { createTab, getTabState, removeTab } from './store'

const respondPermission = vi.fn().mockResolvedValue(undefined)
vi.mock('./bridge', () => ({
  respondPermission: (...a: unknown[]) => respondPermission(...a),
}))

const DESC = '类型：运行终端命令\n命令：\nnpm run build'

function permEvent(requestId: number, desc: string = DESC) {
  return {
    tab_id: 'tab-1',
    type: 'permission_request',
    request_id: requestId,
    description: desc,
    options: [
      { id: 'opt-allow', name: '允许', kind: 'allow' },
      { id: 'opt-deny', name: '拒绝', kind: 'deny' },
    ],
  }
}

describe('权限审批事件链路', () => {
  beforeEach(() => {
    respondPermission.mockClear()
    // 完全清理：removeTab 需先有 tab（容错），记忆按 tab 清
    removeTab('tab-1')
    clearSessionAllowed('tab-1')
    createTab('tab-1', { modelId: 'm' })
  })

  it('第一次请求：未命中记忆 → 弹审批条（permission 写入 tab state）', () => {
    handleSessionEvent(permEvent(1))
    const st = getTabState('tab-1')
    expect(st?.permission).not.toBeNull()
    expect(st?.permission?.command).toBe('npm run build')
    expect(respondPermission).not.toHaveBeenCalled()
  })

  it('点「本次会话允许」后：同命令第二次请求自动放行，不弹窗', () => {
    // 第一次：弹窗
    handleSessionEvent(permEvent(1))
    // 用户点「仅这场对话允许」（与 Permission.tsx onSessionAllow 相同的写入路径）
    const st = getTabState('tab-1')
    const sig = permissionSignature(st!.permission!)
    addSessionAllowed('tab-1', sig)
    // 第二次同命令：命中记忆 → 自动 respond + permission 置空
    handleSessionEvent(permEvent(2))
    expect(respondPermission).toHaveBeenCalledWith('tab-1', 2, 'opt-allow')
    expect(getTabState('tab-1')?.permission).toBeNull()
  })

  it('不同命令：不命中，照常弹窗', () => {
    handleSessionEvent(permEvent(1, DESC))
    const st = getTabState('tab-1')
    const sig = permissionSignature(st!.permission!)
    addSessionAllowed('tab-1', sig)
    // 换一条命令（非只读/非安全 git：安全只读命令按设计自动放行，不走记忆路径）
    handleSessionEvent(permEvent(2, '类型：运行终端命令\n命令：\nnpm run deploy'))
    expect(respondPermission).not.toHaveBeenCalled()
    expect(getTabState('tab-1')?.permission).not.toBeNull()
  })

  it('记忆命中但选项全是拒绝 → 不自动放行，弹窗兜底', () => {
    handleSessionEvent(permEvent(1))
    const st = getTabState('tab-1')
    const sig = permissionSignature(st!.permission!)
    addSessionAllowed('tab-1', sig)
    handleSessionEvent({
      tab_id: 'tab-1',
      type: 'permission_request',
      request_id: 3,
      description: DESC,
      options: [{ id: 'opt-deny', name: '拒绝', kind: 'deny' }],
    } as const)
    expect(respondPermission).not.toHaveBeenCalled()
    expect(getTabState('tab-1')?.permission).not.toBeNull()
  })
})
