import { describe, expect, it } from 'vitest'
import {
  compositionToYaml,
  emptyComposition,
  formatMcpServerLine,
  parseMcpServerLine,
  splitCommandLine,
} from './composition'

describe('组装单 flows 字段', () => {
  it('序列化到 YAML 且不含绝对路径', () => {
    const yaml = compositionToYaml({ ...emptyComposition(), flows: ['demo-linear'] })
    expect(yaml).toContain('flows:')
    expect(yaml).toContain('demo-linear')
    expect(yaml).not.toMatch(/[A-Za-z]:[\\/]/)
  })
})

describe('组装单四路 YAML', () => {
  it('写出人设段落、技能、MCP 命令拆 args、插件目录', () => {
    const yaml = compositionToYaml({
      ...emptyComposition(),
      persona: { label: 'coder', sections: ['回复使用中文。'] },
      skills: { scopes: ['user', 'repo'], exclude: ['web-*'] },
      mcp: {
        servers: [
          {
            name: 'brave',
            url: null,
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search'],
            env: null,
          },
        ],
        disabled_tools: { brave: ['search'] },
      },
      plugins: { dirs: ['./plugins'] },
    })
    expect(yaml).toContain('persona:')
    expect(yaml).toContain('回复使用中文。')
    expect(yaml).toContain('scopes:')
    expect(yaml).toContain('web-*')
    expect(yaml).toContain('command: "npx"')
    expect(yaml).toContain('-y')
    expect(yaml).toContain('disabled_tools:')
    expect(yaml).toContain('./plugins')
  })
})

describe('MCP 命令行', () => {
  it('拆 npx 参数并原样拼回', () => {
    expect(splitCommandLine('npx -y @pkg/foo')).toEqual(['npx', '-y', '@pkg/foo'])
    const parsed = parseMcpServerLine('brave | npx -y @pkg/foo')
    expect(parsed).toEqual({
      name: 'brave',
      url: null,
      command: 'npx',
      args: ['-y', '@pkg/foo'],
      env: null,
    })
    expect(formatMcpServerLine(parsed!)).toBe('brave | npx -y @pkg/foo')
    expect(parseMcpServerLine('docs | https://example.com/mcp')).toEqual({
      name: 'docs',
      url: 'https://example.com/mcp',
      command: null,
      args: null,
      env: null,
    })
  })
})
