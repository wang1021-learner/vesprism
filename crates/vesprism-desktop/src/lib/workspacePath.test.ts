import { describe, expect, it } from 'vitest'
import {
  dedupeWorkspacePaths,
  normalizeWorkspacePath,
  pathUnderWorkspace,
  workspaceFolderName,
} from './workspacePath'

describe('normalizeWorkspacePath', () => {
  it('把 Windows 盘符和长路径折成同一把钥匙', () => {
    expect(normalizeWorkspacePath('D:\\foo\\bar')).toBe(
      normalizeWorkspacePath('d:/foo/bar'),
    )
    expect(normalizeWorkspacePath('\\\\?\\D:\\foo\\bar')).toBe(
      normalizeWorkspacePath('D:\\foo\\bar'),
    )
    expect(normalizeWorkspacePath('D:\\foo\\bar\\')).toBe('d:/foo/bar')
    expect(normalizeWorkspacePath('D:/')).toBe('d:/')
  })
})

describe('pathUnderWorkspace', () => {
  it('根自身和子路径允许，出仓库拒绝', () => {
    expect(pathUnderWorkspace('D:\\proj', 'D:\\proj')).toBe(true)
    expect(pathUnderWorkspace('D:\\proj\\src', 'D:\\proj')).toBe(true)
    expect(pathUnderWorkspace('D:\\proj\\..\\other', 'D:\\proj')).toBe(false)
    expect(pathUnderWorkspace('C:\\Windows', 'D:\\proj')).toBe(false)
  })

  it('空工作区不过滤', () => {
    expect(pathUnderWorkspace('/etc', '')).toBe(true)
  })
})

describe('workspaceFolderName', () => {
  it('取最后一段目录名', () => {
    expect(workspaceFolderName('d:/work/my-app')).toBe('my-app')
  })
})

describe('dedupeWorkspacePaths', () => {
  it('把 d:/ 和 D:\\ 收成一条，并留下系统路径', () => {
    const out = dedupeWorkspacePaths([
      'd:/2026.6.12ai/aisystem/ai_front',
      'D:\\2026.6.12AI\\AISystem\\AI_front',
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe('D:\\2026.6.12AI\\AISystem\\AI_front')
  })
})
