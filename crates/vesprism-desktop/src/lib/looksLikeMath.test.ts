import { describe, expect, it } from 'vitest'
import { looksLikeMath } from './looksLikeMath'

describe('looksLikeMath', () => {
  it('识别块公式与行内公式', () => {
    expect(looksLikeMath('$$x^2$$')).toBe(true)
    expect(looksLikeMath('面积 $S = \\pi r^2$')).toBe(true)
    expect(looksLikeMath('\\(a+b\\)')).toBe(true)
    expect(looksLikeMath('\\[a+b\\]')).toBe(true)
  })

  it('普通对话和代码里的美元符号不算', () => {
    expect(looksLikeMath('你好')).toBe(false)
    expect(looksLikeMath('echo $HOME')).toBe(false)
    expect(looksLikeMath('price is $5')).toBe(false)
  })
})
