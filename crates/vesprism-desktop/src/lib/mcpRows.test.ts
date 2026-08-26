import { describe, expect, it } from 'vitest'
import {
  applyMcpStatusPush,
  applyMcpToolsPush,
  formatEnvBlock,
  groupMcpRows,
  mcpGroupOf,
  normalizeMcpServer,
  parseEnvBlock,
  joinArgs,
  splitArgs,
  validServerName,
} from './mcpRows'

describe('parseEnvBlock / formatEnvBlock', () => {
  it('解析 KEY=VALUE，忽略注释', () => {
    expect(parseEnvBlock('TOKEN=abc\n# skip\nFOO="bar baz"\n')).toEqual({
      TOKEN: 'abc',
      FOO: 'bar baz',
    })
    expect(formatEnvBlock({ A: '1', B: '2' })).toBe('A=1\nB=2')
  })
})

describe('mcpGroupOf', () => {
  it('托管 / 插件 / 本机', () => {
    expect(mcpGroupOf('managed', '', 'http')).toBe('managed')
    expect(mcpGroupOf('local', 'plugin: acme', 'stdio')).toBe('plugin')
    expect(mcpGroupOf('local', 'config.toml', 'stdio')).toBe('local')
  })
})

describe('normalizeMcpServer', () => {
  it('stdio 本地可删可改', () => {
    const row = normalizeMcpServer({
      name: 'fs',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-server-filesystem', '.'],
      source: 'local',
      session: { enabled: true, status: 'ready', tools: [] },
    })
    expect(row.group).toBe('local')
    expect(row.canDelete).toBe(true)
    expect(row.transport).toBe('stdio')
  })

  it('托管不可删', () => {
    const row = normalizeMcpServer({
      name: 'managed_gateway:linear',
      type: 'managedGateway',
      source: 'managed',
      session: { enabled: true, authRequired: true },
    })
    expect(row.group).toBe('managed')
    expect(row.canDelete).toBe(false)
    expect(row.authRequired).toBe(true)
  })
})

describe('groupMcpRows', () => {
  it('托管在前', () => {
    const grouped = groupMcpRows([
      normalizeMcpServer({ name: 'a', source: 'local', type: 'stdio', command: 'npx' }),
      normalizeMcpServer({ name: 'b', source: 'managed', type: 'managedGateway' }),
    ])
    expect(grouped.map((g) => g.group)).toEqual(['managed', 'local'])
  })
})

describe('applyMcpStatusPush', () => {
  it('按 name 改状态', () => {
    const rows = [
      normalizeMcpServer({
        name: 'github',
        type: 'http',
        url: 'https://example',
        session: { enabled: true, status: 'initializing' },
      }),
    ]
    const next = applyMcpStatusPush(rows, { name: 'github', status: 'ready' })
    expect(next[0].status).toBe('ready')
    expect(next[0].authRequired).toBe(false)
  })
})

describe('applyMcpToolsPush', () => {
  it('替换工具列表', () => {
    const rows = [normalizeMcpServer({ name: 'gh', session: { tools: [] } })]
    const next = applyMcpToolsPush(rows, {
      serverName: 'gh',
      tools: [{ name: 'list_issues', enabled: true }],
    })
    expect(next[0].tools.map((t) => t.name)).toEqual(['list_issues'])
  })
})

describe('validServerName / splitArgs', () => {
  it('名称与参数', () => {
    expect(validServerName('filesystem')).toBe(true)
    expect(validServerName('1bad')).toBe(false)
    expect(splitArgs('-y "mcp server" .')).toEqual(['-y', 'mcp server', '.'])
    expect(splitArgs(`-y 'mcp server' .`)).toEqual(['-y', 'mcp server', '.'])
    expect(joinArgs(['-y', 'mcp server', '.'])).toBe(`-y 'mcp server' .`)
    expect(splitArgs(joinArgs(['say "hi"', 'x']))).toEqual(['say "hi"', 'x'])
  })
})
