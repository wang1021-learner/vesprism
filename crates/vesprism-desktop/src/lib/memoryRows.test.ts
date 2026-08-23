import { describe, expect, it } from 'vitest'
import { memoryDirSlug, memoryRowTitle, workspaceFolderName } from './memoryRows'

describe('memoryDirSlug', () => {
  it('全局 MEMORY.md 没有 slug', () => {
    expect(memoryDirSlug('C:/Users/me/.vesprism/memory/MEMORY.md')).toBe('')
  })
  it('仓库目录去掉 8 位 hash', () => {
    expect(
      memoryDirSlug('C:/Users/me/.vesprism/memory/grok-build-a1b2c3d4/MEMORY.md'),
    ).toBe('grok-build')
  })
  it('owner-repo 形式', () => {
    expect(
      memoryDirSlug('/home/u/.vesprism/memory/acme-app-deadbeef/sessions/2026-05-01.md'),
    ).toBe('acme-app')
  })
})

describe('memoryRowTitle', () => {
  it('全局与本仓库标题不同', () => {
    const cwd = 'D:/grokbuild/grok-build'
    const g = memoryRowTitle('/x/memory/MEMORY.md', 'global', cwd)
    const w = memoryRowTitle('/x/memory/grok-build-aaaaaaaa/MEMORY.md', 'workspace', cwd)
    expect(g.title).toBe('所有项目共用')
    expect(g.chip).toBe('全局')
    expect(w.title).toBe('grok-build')
    expect(w.chip).toBe('本仓库')
    expect(w.hint).toContain('当前打开')
  })
  it('会话日志带仓库名', () => {
    const s = memoryRowTitle(
      '/x/memory/grok-build-aaaaaaaa/sessions/2026-05-01.md',
      'session',
      'D:/proj/grok-build',
    )
    expect(s.title).toBe('2026-05-01.md')
    expect(s.hint).toContain('grok-build')
  })
})

describe('workspaceFolderName', () => {
  it('取最后一段', () => {
    expect(workspaceFolderName('D:\\a\\grok-build')).toBe('grok-build')
  })
})
