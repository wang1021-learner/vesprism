/**
 * 权限记忆链路（本次会话允许 / 总是允许）共 10 例
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addAlwaysAllowed,
  addSessionAllowed,
  clearSessionAllowed,
  isAllowOption,
  isAlwaysAllowed,
  isSessionAllowed,
  permissionSignature,
  pickAllowStrict,
  isReadOnlyPermission,
} from './permissionMemory'
import { parsePermissionDescription } from '../types'
import type { PermissionRequest } from '../types'

/** node 测试环境没有 localStorage：提供最小 stub（每次测试前清空） */
const mem = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
}

/** 用真实引擎 description 格式构造权限请求 */
function makeReq(desc: string, kind = 'allow'): PermissionRequest {
  const parsed = parsePermissionDescription(desc)
  return {
    id: '1',
    tool: desc,
    options: [{ id: 'opt-allow', name: '允许', kind }],
    kindLabel: parsed.kindLabel,
    title: parsed.title,
    command: parsed.command,
    summary: parsed.summary,
  }
}

const DESC_TERMINAL = '类型：运行终端命令\n命令：\nnpm run build'
const DESC_READ = '类型：读取文件\n目标：\nsrc/App.tsx'

describe('permissionSignature', () => {
  it('command 优先且稳定（同一 description 两次解析一致）', () => {
    const a = permissionSignature(makeReq(DESC_TERMINAL))
    const b = permissionSignature(makeReq(DESC_TERMINAL))
    expect(a).toBe(b)
    expect(a.startsWith('cmd:')).toBe(true)
  })

  it('不同命令签名不同', () => {
    const a = permissionSignature(makeReq(DESC_TERMINAL))
    const b = permissionSignature(makeReq(DESC_READ))
    expect(a).not.toBe(b)
  })

  it('无 command 时退化到 kindLabel', () => {
    const req = makeReq('类型：执行工具')
    const sig = permissionSignature(req)
    expect(sig.startsWith('kind:')).toBe(true)
  })
})

describe('session 记忆（本次会话允许）', () => {
  beforeEach(() => clearSessionAllowed('tab-1'))

  it('同 tab 同命令命中；不同命令不命中', () => {
    const sig = permissionSignature(makeReq(DESC_TERMINAL))
    addSessionAllowed('tab-1', sig)
    expect(isSessionAllowed('tab-1', sig)).toBe(true)
    expect(isSessionAllowed('tab-1', permissionSignature(makeReq(DESC_READ)))).toBe(false)
  })

  it('按 tab 隔离（tab-2 不命中 tab-1 的记忆）', () => {
    const sig = permissionSignature(makeReq(DESC_TERMINAL))
    addSessionAllowed('tab-1', sig)
    expect(isSessionAllowed('tab-2', sig)).toBe(false)
  })

  it('clearSessionAllowed 清空该 tab 全部记忆', () => {
    const sig = permissionSignature(makeReq(DESC_TERMINAL))
    addSessionAllowed('tab-1', sig)
    clearSessionAllowed('tab-1')
    expect(isSessionAllowed('tab-1', sig)).toBe(false)
  })

  it('端到端：点「本次会话允许」→ 下次同命令自动命中', () => {
    // 第一次请求：弹窗 → 用户点「本次会话允许」
    const req1 = makeReq(DESC_TERMINAL)
    const sig = permissionSignature(req1)
    addSessionAllowed('tab-1', sig)
    // 第二次同一命令（description 相同）：命中
    const req2 = makeReq(DESC_TERMINAL)
    expect(isSessionAllowed('tab-1', permissionSignature(req2))).toBe(true)
    // 放行选项必须能严格找到 allow
    expect(pickAllowStrict(req2.options)?.id).toBe('opt-allow')
  })
})

describe('always 记忆（总是允许）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('写入后可读（持久化 round-trip）', () => {
    const sig = permissionSignature(makeReq(DESC_TERMINAL))
    addAlwaysAllowed(sig)
    expect(isAlwaysAllowed(sig)).toBe(true)
    // 重新从 localStorage 加载
    expect(JSON.parse(localStorage.getItem('jike-perm-always') || '[]')).toContain(sig)
  })

  it('不同命令不命中', () => {
    addAlwaysAllowed(permissionSignature(makeReq(DESC_TERMINAL)))
    expect(isAlwaysAllowed(permissionSignature(makeReq(DESC_READ)))).toBe(false)
  })
})

describe('选项识别', () => {
  it('kind=allow / 中文「允许」都算 allow', () => {
    expect(isAllowOption({ id: 'a', name: '允许', kind: 'allow' })).toBe(true)
    expect(isAllowOption({ id: 'a', name: '允许一次', kind: 'other' })).toBe(true)
    expect(isAllowOption({ id: 'a', name: 'AllowOnce', kind: 'other' })).toBe(true)
  })

  it('拒绝类不算 allow，strict 找不到返回 undefined', () => {
    const denyOnly = [{ id: 'd', name: '拒绝', kind: 'deny' }]
    expect(isAllowOption(denyOnly[0])).toBe(false)
    expect(pickAllowStrict(denyOnly)).toBeUndefined()
  })
})

describe('只读权限', () => {
  it('读取/搜索/网络请求视为只读', () => {
    expect(isReadOnlyPermission({ kindLabel: '读取文件' })).toBe(true)
    expect(isReadOnlyPermission({ kindLabel: '搜索' })).toBe(true)
    expect(isReadOnlyPermission({ kindLabel: '网络请求' })).toBe(true)
    expect(isReadOnlyPermission({ kindLabel: '运行终端命令' })).toBe(false)
    expect(isReadOnlyPermission({ kindLabel: '编辑文件' })).toBe(false)
  })
})
