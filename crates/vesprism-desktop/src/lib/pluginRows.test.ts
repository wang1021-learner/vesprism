import { describe, expect, it } from 'vitest'
import { parsePluginList, pluginStatusLabel, scopeLabel } from './pluginRows'

describe('scopeLabel', () => {
  it('项目/用户对齐成本仓库/本机', () => {
    expect(scopeLabel('project')).toBe('本仓库')
    expect(scopeLabel('user')).toBe('本机')
    expect(scopeLabel('cli')).toBe('本机')
  })
})

describe('parsePluginList', () => {
  it('读官方 camelCase 列表', () => {
    const rows = parsePluginList({
      plugins: [
        {
          id: 'user/abc/demo',
          name: 'demo',
          enabled: true,
          skillCount: 2,
          mcpServerCount: 1,
          description: '测试',
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].skillCount).toBe(2)
    expect(rows[0].mcpCount).toBe(1)
    expect(rows[0].hookCount).toBe(0)
    expect(pluginStatusLabel('blocked')).toBe('已拦截')
  })
})
