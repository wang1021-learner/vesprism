import { describe, expect, it } from 'vitest'
import {
  OFFICE_AGENTS,
  OFFICE_CAPSULES,
  OFFICE_CONNECTORS,
  OFFICE_FORMATS,
  OFFICE_KNOWLEDGE,
  OFFICE_NAV,
  OFFICE_PERMISSIONS,
  OFFICE_SCHEDULES,
  OFFICE_SKILLS,
} from './catalog'

describe('办公模块表', () => {
  it('侧栏七项，技能八条，胶囊覆盖多高频办公场景', () => {
    expect(OFFICE_NAV.map((n) => n.id)).toEqual([
      'home',
      'skills',
      'agents',
      'knowledge',
      'schedule',
      'connectors',
      'history',
    ])
    expect(OFFICE_NAV.find((n) => n.id === 'agents')?.label).toBe('Agent')
    expect(OFFICE_SKILLS).toHaveLength(8)
    expect(OFFICE_CAPSULES.some((c) => c.id === 'weekly')).toBe(true)
    expect(OFFICE_CAPSULES.some((c) => c.id === 'contract')).toBe(true)
    expect(OFFICE_CAPSULES.some((c) => c.id === 'excel_analysis')).toBe(true)
    expect(OFFICE_AGENTS.length).toBeGreaterThanOrEqual(5)
    expect(OFFICE_KNOWLEDGE.length).toBeGreaterThanOrEqual(4)
    expect(OFFICE_SCHEDULES.length).toBeGreaterThanOrEqual(4)
    expect(OFFICE_CONNECTORS.length).toBeGreaterThanOrEqual(5)
  })

  it('徽章等于数组长度，连接器不是已接，格式三项，权限和技能标明演示预览', () => {
    expect(OFFICE_NAV.find((n) => n.id === 'skills')?.badge).toBe(String(OFFICE_SKILLS.length))
    expect(OFFICE_NAV.find((n) => n.id === 'agents')?.badge).toBe(String(OFFICE_AGENTS.length))
    expect(OFFICE_NAV.find((n) => n.id === 'knowledge')?.badge).toBe(
      String(OFFICE_KNOWLEDGE.length),
    )
    expect(OFFICE_NAV.find((n) => n.id === 'schedule')?.badge).toBe(
      String(OFFICE_SCHEDULES.length),
    )
    expect(OFFICE_NAV.find((n) => n.id === 'connectors')?.badge).toBe(
      String(OFFICE_CONNECTORS.length),
    )
    expect(OFFICE_CONNECTORS.every((c) => c.status !== 'connected')).toBe(true)
    expect(OFFICE_FORMATS.map((f) => f.id)).toEqual(['doc', 'pptx', 'xlsx'])
    expect(OFFICE_FORMATS.every((f) => !f.label.includes('.docx'))).toBe(true)
    expect(OFFICE_PERMISSIONS.find((p) => p.id === 'full')?.label).toContain('演示')
    expect(OFFICE_SKILLS.every((s) => !s.outputType.includes('.docx'))).toBe(true)
    expect(OFFICE_SKILLS.every((s) => s.format === 'doc' || s.format === 'pptx' || s.format === 'xlsx')).toBe(
      true,
    )
    expect(OFFICE_SCHEDULES.every((s) => s.target === '不会发送')).toBe(true)
    expect(OFFICE_AGENTS.every((a) => a.avatar.length <= 2 && !/\p{Extended_Pictographic}/u.test(a.avatar))).toBe(
      true,
    )
  })
})
