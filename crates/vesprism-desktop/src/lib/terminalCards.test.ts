import { describe, expect, it } from 'vitest'
import { keepTail, terminalOutcome, terminalStatusLabel } from './terminalCards'

describe('keepTail', () => {
  it('短文本不截断', () => {
    expect(keepTail('hello', 64)).toEqual({ text: 'hello', truncated: false })
  })

  it('超过上限砍头留尾', () => {
    const src = 'AAAA' + 'B'.repeat(20)
    const { text, truncated } = keepTail(src, 10)
    expect(truncated).toBe(true)
    expect(text.endsWith('B'.repeat(10))).toBe(true)
    expect(text.startsWith('A')).toBe(false)
    expect(text.length).toBeLessThanOrEqual(10)
  })
})

describe('terminalOutcome', () => {
  it('区分完成 / 失败 / 已终止', () => {
    expect(terminalOutcome({ exited: false })).toBe('running')
    expect(terminalOutcome({ exited: true, exitCode: 0 })).toBe('ok')
    expect(terminalOutcome({ exited: true, exitCode: 3 })).toBe('fail')
    expect(terminalOutcome({ exited: true, exitCode: 1, killed: true })).toBe('killed')
    expect(terminalStatusLabel({ exited: true, exitCode: 0 })).toBe('完成')
    expect(terminalStatusLabel({ exited: true, exitCode: 3 })).toBe('失败（exit 3）')
    expect(terminalStatusLabel({ exited: true, killed: true, exitCode: 1 })).toBe('已终止')
  })
})


