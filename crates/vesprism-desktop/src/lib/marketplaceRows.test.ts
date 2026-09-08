import { describe, expect, it } from 'vitest'
import { installStatusLabel, parseMarketplaceList } from './marketplaceRows'

describe('parseMarketplaceList', () => {
  it('读官方 camelCase 源和插件', () => {
    const sources = parseMarketplaceList({
      sources: [
        {
          sourceName: '官方',
          sourceKind: 'git',
          sourceUrlOrPath: 'https://github.com/example/plugins',
          error: null,
          plugins: [
            {
              name: 'demo',
              version: '1.0.0',
              description: '示例',
              relativePath: 'demo',
              skillCount: 2,
              hasHooks: true,
              hasMcp: false,
              installStatus: 'not_installed',
              remoteUrl: 'https://github.com/example/plugins',
            },
          ],
        },
      ],
    })
    expect(sources).toHaveLength(1)
    expect(sources[0].name).toBe('官方')
    expect(sources[0].plugins[0].skillCount).toBe(2)
    expect(sources[0].plugins[0].hasHooks).toBe(true)
    expect(sources[0].policyDenied).toBe(false)
    expect(installStatusLabel(sources[0].plugins[0].installStatus)).toBe('未安装')
  })

  it('源被企业策略拦截时标 policyDenied', () => {
    const sources = parseMarketplaceList({
      sources: [
        {
          sourceName: '第三方',
          sourceUrlOrPath: 'https://evil.example/plugins',
          error: 'source not in strictKnownMarketplaces (requirements.toml)',
          plugins: [],
        },
      ],
    })
    expect(sources[0].policyDenied).toBe(true)
    expect(sources[0].error).toContain('strictKnownMarketplaces')
  })

  it('空输入得到空列表', () => {
    expect(parseMarketplaceList(null)).toEqual([])
    expect(parseMarketplaceList({})).toEqual([])
  })
})
