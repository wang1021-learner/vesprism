import { describe, expect, it } from 'vitest'
import { isValidAgentId, slugifyAgentId } from './types'

describe('Agent id', () => {
  it('接受 slug，拒绝大写与双连字符', () => {
    expect(isValidAgentId('pr-reviewer')).toBe(true)
    expect(isValidAgentId('PR')).toBe(false)
    expect(isValidAgentId('a--b')).toBe(false)
  })

  it('slugify 收成小写连字符', () => {
    expect(slugifyAgentId('PR Reviewer')).toBe('pr-reviewer')
  })
})
