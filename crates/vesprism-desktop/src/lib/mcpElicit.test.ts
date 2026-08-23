import { describe, expect, it } from 'vitest'
import {
  checkElicitUrl,
  collectElicitContent,
  defaultValue,
  parseElicitSchema,
  type ElicitFieldValue,
} from './mcpElicit'

describe('parseElicitSchema', () => {
  it('解析 string / boolean / enum', () => {
    const { fields, error } = parseElicitSchema({
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', title: '邮箱' },
        ok: { type: 'boolean', default: true },
        color: { type: 'string', enum: ['red', 'blue'], default: 'blue' },
      },
    })
    expect(error).toBeUndefined()
    expect(fields.map((f) => f.kind)).toEqual(['string', 'boolean', 'single'])
    expect(fields[0].required).toBe(true)
    expect(fields[1].defaultBool).toBe(true)
    expect(fields[2].defaultIndex).toBe(1)
  })
})

describe('collectElicitContent', () => {
  it('必填空值报错；填了就进 content', () => {
    const { fields } = parseElicitSchema({
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', format: 'email' } },
    })
    const empty: ElicitFieldValue[] = [defaultValue(fields[0])]
    expect(collectElicitContent(fields, empty).errors.email).toBe('必填')
    const filled: ElicitFieldValue[] = [{ kind: 'text', draft: 'a@b.com' }]
    expect(collectElicitContent(fields, filled).content).toEqual({ email: 'a@b.com' })
  })
})

describe('checkElicitUrl', () => {
  it('只允许 http(s) 且不要账号密码', () => {
    const ok = checkElicitUrl('https://example.com/auth')
    expect('url' in ok && ok.host).toBe('example.com')
    expect('error' in checkElicitUrl('ftp://x')).toBe(true)
    expect('error' in checkElicitUrl('https://user:pass@x.com')).toBe(true)
  })
})
