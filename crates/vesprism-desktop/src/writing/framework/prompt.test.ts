import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from '../model/demo-yanpin'
import {
  assembleWriteChapter,
  promptContainsForbiddenOutline,
  reviewerUser,
  writerSystem,
  writerUser,
} from './prompt'

describe('写手提示词', () => {
  it('第4章吃切片和上章摘要，不吃总纲因果', () => {
    const user = writerUser(YANPIN_EYE, 'ch-4')
    expect(user).toBeTruthy()
    if (!user) return
    expect(user).toContain('限知沈见真')
    expect(user).toContain('到期 F001')
    expect(user).toContain('节拍1 旧门')
    expect(user).toContain('上章摘要')
    expect(user).toContain('顾晚宁')
    expect(promptContainsForbiddenOutline(user, YANPIN_EYE)).toBe(false)
    expect(user.includes(YANPIN_EYE.outline.causality)).toBe(false)
  })

  it('第5章已锁，不组装写手词', () => {
    expect(writerUser(YANPIN_EYE, 'ch-5')).toBeNull()
    expect(assembleWriteChapter(YANPIN_EYE, 'ch-5')).toBeNull()
  })

  it('系统词禁止总纲和发明规则', () => {
    const sys = writerSystem()
    expect(sys).toMatch(/只吃用户给出的切片/)
    expect(sys).toMatch(/总纲全文/)
    expect(sys).toMatch(/发明新规则/)
  })

  it('入卷词带正文，仍不带总纲全文', () => {
    const user = reviewerUser(YANPIN_EYE, 'ch-4')
    expect(user).toContain('看清了吗')
    expect(user).toContain('——正文——')
    expect(promptContainsForbiddenOutline(user ?? '', YANPIN_EYE)).toBe(false)
  })
})
