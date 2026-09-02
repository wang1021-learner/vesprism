import { describe, expect, it } from 'vitest'
import { parseOfficeSlash, slashHits } from './slash'

describe('office slash', () => {
  it('无斜杠原样交稿', () => {
    expect(parseOfficeSlash('写周报')).toEqual({ prompt: '写周报' })
  })

  it('/pptx 抽出格式，正文是后面的话', () => {
    expect(parseOfficeSlash('/pptx 做八页')).toEqual({ prompt: '做八页', format: 'pptx' })
  })

  it('/pdf 没有渲染器，落成文稿预览', () => {
    expect(parseOfficeSlash('/pdf')).toEqual({ prompt: '出一份 pdf 预览', format: 'doc' })
  })

  it('输入 /do 只命中 docx', () => {
    expect(slashHits('/do').map((s) => s.id)).toEqual(['docx'])
  })
})
