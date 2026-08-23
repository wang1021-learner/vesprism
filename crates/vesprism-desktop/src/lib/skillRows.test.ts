import { describe, expect, it } from 'vitest'
import {
  isSkillAddPath,
  parseOfficialSkills,
  parseSkillsFromCommands,
  skillPreviewBody,
} from './skillRows'

describe('parseOfficialSkills', () => {
  it('读官方字段并标出可移除的 config 路径', () => {
    const rows = parseOfficialSkills([
      {
        name: 'review',
        display_name: '代码审查',
        description: '审这次改动',
        path: 'D:/skills/review/SKILL.md',
        scope: 'user',
        enabled: false,
        user_invocable: true,
        disable_model_invocation: true,
        config_source: { type: 'configToml' },
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].displayName).toBe('代码审查')
    expect(rows[0].enabled).toBe(false)
    expect(rows[0].disableModelInvocation).toBe(true)
    expect(rows[0].removable).toBe(true)
  })
})

describe('parseSkillsFromCommands', () => {
  it('只要 scope+path，跳过工作流', () => {
    const rows = parseSkillsFromCommands([
      {
        name: '/ui-design',
        description: '做界面',
        meta: { scope: 'local', path: '.grok/skills/ui-design/SKILL.md' },
      },
      {
        name: '/ship',
        description: '工作流',
        meta: { workflowPath: 'a.rhai', workflowSource: 'user' },
      },
    ])
    expect(rows.map((r) => r.name)).toEqual(['ui-design'])
    expect(rows[0].userInvocable).toBe(true)
  })
})

describe('isSkillAddPath', () => {
  it('接受 SKILL.md 或目录', () => {
    expect(isSkillAddPath('D:\\\\skills\\\\foo\\\\SKILL.md')).toBe(true)
    expect(isSkillAddPath('D:/skills/foo')).toBe(true)
    expect(isSkillAddPath('readme.md')).toBe(false)
    expect(isSkillAddPath('')).toBe(false)
  })
})

describe('skillPreviewBody', () => {
  it('去掉 frontmatter', () => {
    expect(skillPreviewBody('---\nname: a\n---\n\n正文\n')).toBe('正文')
    expect(skillPreviewBody('没有头')).toBe('没有头')
  })
})
