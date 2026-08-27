import { describe, expect, it } from 'vitest'
import {
  collapseSlashAliases,
  commandKind,
  filterComposerCommands,
  groupComposerCommands,
  mergeComposerCommands,
  parseOfficialCommands,
  type ComposerCommand,
} from './composerCommands'

describe('commandKind', () => {
  it('工作流优先，含 snake_case', () => {
    expect(
      commandKind({
        name: 'ship',
        meta: { workflow_path: 'a.rhai', workflow_source: 'user' },
      }),
    ).toBe('workflow')
    expect(
      commandKind({
        name: 'ship',
        meta: { workflowPath: 'a.rhai', scope: 'user', path: 'x' },
      }),
    ).toBe('workflow')
  })

  it('scope+path 算技能', () => {
    expect(
      commandKind({
        name: 'ui-design',
        meta: { scope: 'local', path: '.grok/skills/ui-design/SKILL.md' },
      }),
    ).toBe('skill')
  })

  it('无 meta 算命令', () => {
    expect(commandKind({ name: 'help' })).toBe('command')
  })
})

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
    expect(cmds[0].hint).toContain('长程规划')
  })

  it('技能用自己的说明，不被同名内置命令词条盖掉', () => {
    const cmds = parseOfficialCommands([
      {
        name: 'review',
        description: '审这次改动',
        meta: {
          scope: 'user',
          path: '/skills/review/SKILL.md',
          displayName: '代码审查包',
        },
      },
    ])
    expect(cmds[0].kind).toBe('skill')
    expect(cmds[0].hint).toBe('审这次改动')
    expect(cmds[0].sourceLabel).toBe('本机')
    expect(cmds[0].displayName).toBe('代码审查包')
  })

  it('按 meta 标技能 / 工作流，来源跟设置页同一套中文', () => {
    const cmds = parseOfficialCommands([
      {
        name: 'ui-design',
        description: '做界面',
        meta: { scope: 'local', path: '.grok/skills/ui-design/SKILL.md' },
      },
      {
        name: 'ship',
        description: 'Workflow: 发版',
        meta: { workflowPath: 'a.rhai', workflowSource: 'user' },
      },
    ])
    expect(cmds.map((c) => c.kind)).toEqual(['skill', 'workflow'])
    expect(cmds[0].sourceLabel).toBe('本仓库')
    expect(cmds[1].sourceLabel).toBe('本机')
    expect(cmds[1].hint).toBe('发版')
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
    expect(merged.map((c) => c.label)).toEqual(['/goal', '/sandbox'])
  })
})

describe('filterComposerCommands', () => {
  it('按前缀、说明、分类过滤', () => {
    const items: ComposerCommand[] = [
      { id: 'a', label: '/goal', hint: '长程规划', insert: '/goal ', kind: 'command' },
      {
        id: 'b',
        label: '/ui-design',
        hint: '做界面',
        insert: '/ui-design ',
        kind: 'skill',
        sourceLabel: '本仓库',
      },
    ]
    expect(filterComposerCommands(items, 're').map((c) => c.label)).toEqual([])
    expect(filterComposerCommands(items, '规划').map((c) => c.label)).toEqual(['/goal'])
    expect(filterComposerCommands(items, '技能').map((c) => c.label)).toEqual(['/ui-design'])
    expect(filterComposerCommands(items, '本仓库').map((c) => c.label)).toEqual([
      '/ui-design',
    ])
  })
})

describe('collapseSlashAliases', () => {
  const items: ComposerCommand[] = [
    { id: 'a', label: '/view-plan', hint: '计划稿', insert: '', kind: 'command' },
    { id: 'b', label: '/show-plan', hint: '计划稿', insert: '', kind: 'command' },
    { id: 'c', label: '/plan-view', hint: '计划稿', insert: '', kind: 'command' },
    { id: 'd', label: '/compact', hint: '压缩', insert: '', kind: 'command' },
    { id: 'e', label: '/usage', hint: '用量', insert: '', kind: 'command' },
    { id: 'f', label: '/help', hint: '帮助', insert: '', kind: 'command' },
  ]

  it('空查询只留每组首选', () => {
    expect(collapseSlashAliases(items, '').map((c) => c.label)).toEqual([
      '/view-plan',
      '/compact',
      '/usage',
      '/help',
    ])
  })

  it('打出别名时露出那一条', () => {
    expect(collapseSlashAliases(items, 'show').map((c) => c.label)).toEqual([
      '/show-plan',
      '/compact',
      '/usage',
      '/help',
    ])
    expect(collapseSlashAliases(items, 'usage').map((c) => c.label)).toEqual([
      '/view-plan',
      '/compact',
      '/usage',
      '/help',
    ])
  })
})

describe('groupComposerCommands', () => {
  it('命令 → 技能 → 工作流，技能按来源排', () => {
    const items: ComposerCommand[] = [
      {
        id: 's2',
        label: '/bundled-skill',
        hint: '',
        insert: '',
        kind: 'skill',
        source: 'bundled',
      },
      { id: 'c', label: '/help', hint: '', insert: '', kind: 'command' },
      {
        id: 's1',
        label: '/local-skill',
        hint: '',
        insert: '',
        kind: 'skill',
        source: 'local',
      },
      {
        id: 'w',
        label: '/ship',
        hint: '',
        insert: '',
        kind: 'workflow',
        source: 'user',
      },
    ]
    const groups = groupComposerCommands(items)
    expect(groups.map((g) => g.kind)).toEqual(['command', 'skill', 'workflow'])
    expect(groups[1].items.map((x) => x.label)).toEqual([
      '/local-skill',
      '/bundled-skill',
    ])
  })
})
