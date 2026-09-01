import { describe, expect, it } from 'vitest'
import {
  OFFICE_CAPSULES,
  OFFICE_CONNECTORS,
  OFFICE_EXPERTS,
  OFFICE_KNOWLEDGE,
  OFFICE_NAV,
  OFFICE_SCHEDULES,
  OFFICE_SKILLS,
} from './catalog'

describe('办公模块表', () => {
  it('侧栏七项，技能八条，胶囊覆盖多高频办公场景', () => {
    expect(OFFICE_NAV.map((n) => n.id)).toEqual([
      'home',
      'skills',
      'experts',
      'knowledge',
      'schedule',
      'connectors',
      'history',
    ])
    expect(OFFICE_SKILLS).toHaveLength(8)
    expect(OFFICE_CAPSULES.some((c) => c.id === 'weekly')).toBe(true)
    expect(OFFICE_CAPSULES.some((c) => c.id === 'contract')).toBe(true)
    expect(OFFICE_CAPSULES.some((c) => c.id === 'excel_analysis')).toBe(true)
    expect(OFFICE_EXPERTS.length).toBeGreaterThanOrEqual(5)
    expect(OFFICE_KNOWLEDGE.length).toBeGreaterThanOrEqual(4)
    expect(OFFICE_SCHEDULES.length).toBeGreaterThanOrEqual(4)
    expect(OFFICE_CONNECTORS.length).toBeGreaterThanOrEqual(5)
  })
})
