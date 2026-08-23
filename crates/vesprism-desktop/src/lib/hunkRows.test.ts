import { describe, expect, it } from 'vitest'
import { hunkActionOk, parseHunkFiles, parseHunks, relPath } from './hunkRows'

describe('parseHunkFiles', () => {
  it('读 camelCase 文件摘要', () => {
    const rows = parseHunkFiles({
      files: [
        {
          path: 'D:/repo/src/a.ts',
          isAgentFile: true,
          staged: false,
          hunkCount: 2,
          additions: 5,
          deletions: 1,
        },
      ],
    })
    expect(rows).toEqual([
      {
        path: 'D:/repo/src/a.ts',
        isAgentFile: true,
        staged: false,
        hunkCount: 2,
        additions: 5,
        deletions: 1,
      },
    ])
  })
})

describe('parseHunks', () => {
  it('id 为字符串，source 为 AgentEdit', () => {
    const rows = parseHunks({
      hunks: [
        {
          id: 'abc-123',
          path: 'D:/repo/a.ts',
          patch: '@@\n-old\n+new\n',
          oldText: 'old',
          newText: 'new',
          source: { agentEdit: { promptIndex: 3 } },
        },
      ],
    })
    expect(rows[0]).toMatchObject({
      id: 'abc-123',
      source: 'agent',
      promptIndex: 3,
    })
  })
})

describe('hunkActionOk / relPath', () => {
  it('失败带 error', () => {
    expect(hunkActionOk({ success: false, error: 'not found' }).ok).toBe(false)
    expect(hunkActionOk({ success: true, affectedCount: 2 }).affected).toBe(2)
  })
  it('去掉 cwd 前缀', () => {
    expect(relPath('D:/repo/src/a.ts', 'D:/repo')).toBe('src/a.ts')
  })
})
