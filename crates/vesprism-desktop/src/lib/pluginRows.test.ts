import { describe, expect, it } from 'vitest'
import { parsePluginList } from './pluginRows'

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
  })
})
