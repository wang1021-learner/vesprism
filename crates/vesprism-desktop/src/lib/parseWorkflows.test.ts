import { describe, expect, it } from 'vitest'
import {
  parseWorkflowListings,
  parseWorkflowsFromCommands,
  sourceBucket,
  sourceLabel,
  sourceRank,
} from './parseWorkflows'

describe('parseWorkflowListings', () => {
  it('规范化 name / description / source / path 并排序', () => {
    const rows = parseWorkflowListings([
      {
        name: 'zebra',
        description: 'Workflow: Z task',
        when_to_use: 'when z',
        source: 'user',
        path: '/home/u/.grok/workflows/zebra.rhai',
      },
      {
        name: 'alpha',
        description: 'A task',
        source: 'project',
        path: '/repo/.grok/workflows/alpha.rhai',
      },
      null,
      { name: '', description: 'skip' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('alpha')
    expect(rows[0].source).toBe('project')
    expect(rows[0].description).toBe('A task')
    expect(rows[1].name).toBe('zebra')
    expect(rows[1].description).toBe('Z task')
    expect(rows[1].whenToUse).toBe('when z')
  })

  it('去重同名', () => {
    const rows = parseWorkflowListings([
      { name: 'review', description: 'first', source: 'project' },
      { name: '/review', description: 'second', source: 'user' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('first')
  })

  it('同名时保留来源更优先的（项目盖过内置）', () => {
    const rows = parseWorkflowListings([
      { name: 'deploy', description: 'bundled', source: 'bundled' },
      { name: 'deploy', description: 'project copy', source: 'project' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('project')
    expect(rows[0].description).toBe('project copy')
  })
})

describe('parseWorkflowsFromCommands', () => {
  it('只保留带 workflowPath/workflowSource 的命令', () => {
    const rows = parseWorkflowsFromCommands([
      {
        name: 'help',
        description: 'skill-like',
        meta: { scope: 'user', path: '/skills/help' },
      },
      {
        name: 'review-changes',
        description: 'Workflow: Review PR',
        meta: {
          workflowSource: 'project',
          workflowPath: '/repo/.grok/workflows/review-changes.rhai',
        },
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('review-changes')
    expect(rows[0].source).toBe('project')
    expect(rows[0].path).toContain('review-changes.rhai')
    expect(rows[0].description).toBe('Review PR')
  })

  it('空输入返回 []', () => {
    expect(parseWorkflowsFromCommands(null)).toEqual([])
    expect(parseWorkflowsFromCommands(undefined)).toEqual([])
    expect(parseWorkflowsFromCommands([])).toEqual([])
  })
})

describe('source helpers', () => {
  it('sourceRank project < user', () => {
    expect(sourceRank('project')).toBeLessThan(sourceRank('user'))
  })

  it('sourceLabel 中文', () => {
    expect(sourceLabel('project')).toBe('本仓库')
    expect(sourceLabel('local')).toBe('本仓库')
    expect(sourceLabel('user')).toBe('本机')
    expect(sourceLabel('bundled')).toBe('内置')
  })

  it('project/local/repo 合成一个本仓库桶', () => {
    expect(sourceBucket('project')).toBe('workspace')
    expect(sourceBucket('local')).toBe('workspace')
    expect(sourceBucket('repo')).toBe('workspace')
    expect(sourceBucket('user')).toBe('machine')
  })
})
