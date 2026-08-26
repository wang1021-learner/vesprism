import { describe, expect, it } from 'vitest'
import { safeMarkdownHref, safeMarkdownImgSrc } from './safeMarkdownUrl'

describe('safeMarkdownHref', () => {
  it('放行 http(s) 和 mailto、页内锚点', () => {
    expect(safeMarkdownHref('https://example.com')).toBe('https://example.com')
    expect(safeMarkdownHref('http://localhost')).toBe('http://localhost')
    expect(safeMarkdownHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(safeMarkdownHref('#section')).toBe('#section')
  })

  it('剥掉 javascript / file / 相对协议', () => {
    expect(safeMarkdownHref('javascript:alert(1)')).toBeUndefined()
    expect(safeMarkdownHref('file:///etc/passwd')).toBeUndefined()
    expect(safeMarkdownHref('asset://localhost/x')).toBeUndefined()
    expect(safeMarkdownHref('')).toBeUndefined()
  })
})

describe('safeMarkdownImgSrc', () => {
  it('放行 http(s) 与 data:image', () => {
    expect(safeMarkdownImgSrc('https://x/a.png')).toBe('https://x/a.png')
    expect(safeMarkdownImgSrc('data:image/png;base64,aaa')).toContain('data:image/png')
  })

  it('剥掉 javascript 和 file', () => {
    expect(safeMarkdownImgSrc('javascript:alert(1)')).toBeUndefined()
    expect(safeMarkdownImgSrc('file:///tmp/x.png')).toBeUndefined()
  })
})
