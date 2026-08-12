import { describe, expect, it } from 'vitest'
import {
  parseWorkflowListings,
  parseWorkflowsFromCommands,
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
    expect(sourceLabel('project')).toBe('项目')
    expect(sourceLabel('user')).toBe('用户')
    expect(sourceLabel('bundled')).toBe('内置')
  })
})
