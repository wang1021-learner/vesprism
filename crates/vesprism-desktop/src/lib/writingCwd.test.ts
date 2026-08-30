import { describe, expect, it } from 'vitest'
import { isWritingSessionCwd } from './writingCwd'

describe('写台会话目录识别', () => {
  it('把 ~/.vesprism/writing/<id> 认成写台，不把普通仓库认成写台', () => {
    expect(isWritingSessionCwd('C:\\Users\\x\\.vesprism\\writing\\book-1')).toBe(true)
    expect(isWritingSessionCwd('/home/u/.vesprism/writing/book-1')).toBe(true)
    expect(isWritingSessionCwd('/home/u/code/app')).toBe(false)
    expect(isWritingSessionCwd('')).toBe(false)
  })
})
