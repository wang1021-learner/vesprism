import { describe, expect, it } from 'vitest'
import { permissionDetailLabel, permissionLead } from './permissionCopy'

describe('permissionLead', () => {
  it('有类型就当标题，摘要当旁注', () => {
    expect(
      permissionLead({ kindLabel: '运行终端命令', summary: 'npm run build' }),
    ).toEqual({ title: '运行终端命令', note: 'npm run build' })
  })

  it('缺类型时标题是「需要审批」', () => {
    expect(permissionLead({ summary: 'foo' })).toEqual({
      title: '需要审批',
      note: 'foo',
    })
  })

  it('类型和摘要相同就不重复旁注', () => {
    expect(
      permissionLead({ kindLabel: '读取文件', summary: '读取文件' }),
    ).toEqual({ title: '读取文件', note: '' })
  })
})

describe('permissionDetailLabel', () => {
  it('按类型选折叠按钮文案', () => {
    expect(permissionDetailLabel('运行终端命令')).toBe('命令')
    expect(permissionDetailLabel('编辑文件')).toBe('目标')
    expect(permissionDetailLabel('读取文件')).toBe('目标')
    expect(permissionDetailLabel('网络请求')).toBe('详情')
    expect(permissionDetailLabel()).toBe('详情')
  })
})
