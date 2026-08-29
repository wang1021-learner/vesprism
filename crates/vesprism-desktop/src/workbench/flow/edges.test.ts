import { describe, expect, it } from 'vitest'
import {
  canonicalBranchLabel,
  displayBranchLabel,
  persistEdgeLabel,
  persistSourceHandle,
} from './edges'

describe('branch edge canonicalization', () => {
  it('展示中文，落盘英文', () => {
    expect(displayBranchLabel('success', undefined)).toBe('成功')
    expect(displayBranchLabel('failure', 'failure')).toBe('失败')
    expect(persistEdgeLabel('success', '成功')).toBe('success')
    expect(persistEdgeLabel(undefined, '失败')).toBe('failure')
    expect(persistSourceHandle(undefined, '成功')).toBe('success')
    expect(canonicalBranchLabel('case-2', '审核通过')).toBeUndefined()
    expect(persistEdgeLabel('case-2', '审核通过')).toBe('审核通过')
    expect(persistSourceHandle('case-2', '审核通过')).toBe('case-2')
  })
})
