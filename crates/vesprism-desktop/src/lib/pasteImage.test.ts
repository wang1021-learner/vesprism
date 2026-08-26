import { describe, expect, it } from 'vitest'
import { clipboardImageFiles } from './pasteImage'

function img(name: string, type: string, size = 12, lastModified = 1): File {
  const buf = new Uint8Array(size)
  return new File([buf], name, { type, lastModified })
}

function fakeDT(opts: { items?: File[]; files?: File[] }): DataTransfer {
  const items = (opts.items ?? []).map((f) => ({
    kind: 'file' as const,
    type: f.type,
    getAsFile: () => f,
  }))
  return {
    items,
    files: opts.files ?? [],
  } as unknown as DataTransfer
}

describe('clipboardImageFiles', () => {
  it('items 和 files 是同一张图的两个对象时只留一份', () => {
    const a = img('image.png', 'image/png', 80, 1)
    const b = img('image.png', 'image/png', 80, 99)
    expect(a).not.toBe(b)
    const out = clipboardImageFiles(fakeDT({ items: [a], files: [b] }))
    expect(out).toHaveLength(1)
    expect(out[0]?.type).toBe('image/png')
  })

  it('files 已有图时不再扫 items', () => {
    const file = img('shot.png', 'image/png', 40)
    const extra = img('image.bmp', 'image/bmp', 99, 2)
    const out = clipboardImageFiles(fakeDT({ items: [extra], files: [file] }))
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('shot.png')
  })

  it('files 为空时从 items 取', () => {
    const a = img('image.png', 'image/png')
    const out = clipboardImageFiles(fakeDT({ items: [a], files: [] }))
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(a)
  })

  it('截图同时带 png 和 bmp 只留 png', () => {
    const png = img('image.png', 'image/png', 50)
    const bmp = img('image.bmp', 'image/bmp', 80, 2)
    const out = clipboardImageFiles(fakeDT({ items: [png, bmp], files: [] }))
    expect(out).toHaveLength(1)
    expect(out[0]?.type).toBe('image/png')
  })

  it('两张真实图片都保留', () => {
    const a = img('cat.png', 'image/png', 10)
    const b = img('dog.png', 'image/png', 20, 2)
    const out = clipboardImageFiles(fakeDT({ files: [a, b] }))
    expect(out).toHaveLength(2)
  })

  it('空剪贴板返回空', () => {
    expect(clipboardImageFiles(null)).toEqual([])
    expect(clipboardImageFiles(fakeDT({}))).toEqual([])
  })
})
