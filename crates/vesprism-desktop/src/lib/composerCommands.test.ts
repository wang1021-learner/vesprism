import { describe, expect, it } from 'vitest'
import {
  filterComposerCommands,
  mergeComposerCommands,
  parseOfficialCommands,
  type ComposerCommand,
} from './composerCommands'

describe('parseOfficialCommands', () => {
  it('去 / 前缀并去重', () => {
    const cmds = parseOfficialCommands([
      { name: '/goal', description: 'Plan then execute' },
      { name: 'goal', description: 'dup' },
      { name: '', description: 'skip' },
    ])
    expect(cmds).toHaveLength(1)
    expect(cmds[0].label).toBe('/goal')
    expect(cmds[0].insert).toBe('/goal ')
    expect(cmds[0].kind).toBe('command')
  })

  it('按 meta 标技能 / 工作流', () => {
    const cmds = parseOfficialCommands([
      {
        name: 'ui-design',
        description: '做界面',
        meta: { scope: 'local', path: '.grok/skills/ui-design/SKILL.md' },
      },
      {
        name: 'ship',
        description: '发版',
        meta: { workflowPath: 'a.rhai', workflowSource: 'user' },
      },
    ])
    expect(cmds.map((c) => c.kind)).toEqual(['skill', 'workflow'])
  })
})

describe('mergeComposerCommands', () => {
  it('本地命令补官方没有的', () => {
    const official: ComposerCommand[] = [
      { id: 'cmd-goal', label: '/goal', hint: '规划', insert: '/goal ' },
    ]
    const extras: ComposerCommand[] = [
      { id: 'sandbox', label: '/sandbox', hint: '副本', insert: '' },
      { id: 'goal', label: '/goal', hint: '本地', insert: '/goal ' },
    ]
    const merged = mergeComposerCommands(official, extras)
    expect(merged.map((c) => c.label)).toEqual(['/sandbox', '/goal'])
  })
})

describe('filterComposerCommands', () => {
  it('按前缀和说明过滤', () => {
    const items: ComposerCommand[] = [
      { id: 'a', label: '/goal', hint: '长程规划', insert: '/goal ' },
      { id: 'b', label: '/rewind', hint: '回滚会话', insert: '' },
    ]
    expect(filterComposerCommands(items, 're').map((c) => c.label)).toEqual(['/rewind'])
    expect(filterComposerCommands(items, '规划').map((c) => c.label)).toEqual(['/goal'])
  })
})
