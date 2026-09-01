import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { $scratchCwd } from '../store'
import {
  formatSearchTimeLabel,
  normalizeCwdKey,
  workspaceDisplayName,
} from './sidebarFormat'

describe('normalizeCwdKey', () => {
  it('空路径变成未知工作空间', () => {
    expect(normalizeCwdKey(undefined)).toBe('(未知工作空间)')
    expect(normalizeCwdKey('')).toBe('(未知工作空间)')
    expect(normalizeCwdKey('   ')).toBe('(未知工作空间)')
  })

  it('和 session_index 同一把钥匙：盘符、反斜杠、尾斜杠', () => {
    expect(normalizeCwdKey('D:\\foo\\bar')).toBe('d:/foo/bar')
    expect(normalizeCwdKey('D:\\foo\\bar\\')).toBe('d:/foo/bar')
    expect(normalizeCwdKey('d:/foo/bar')).toBe('d:/foo/bar')
  })
})

describe('workspaceDisplayName', () => {
  beforeEach(() => {
    $scratchCwd.set('D:/Users/me/.vesprism/scratch')
  })

  it('未知工作空间保持原文', () => {
    expect(workspaceDisplayName('')).toBe('(未知工作空间)')
  })

  it('闲聊工作区显示闲聊', () => {
    expect(workspaceDisplayName('D:/Users/me/.vesprism/scratch')).toBe('闲聊')
    expect(workspaceDisplayName('C:/proj/.vesprism/scratch')).toBe('闲聊')
  })

  it('项目路径取最后一段目录名', () => {
    expect(workspaceDisplayName('d:/work/my-app')).toBe('my-app')
    expect(workspaceDisplayName('D:\\Work\\MyApp')).toBe('myapp')
  })
})

describe('formatSearchTimeLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('空或非法日期返回空串', () => {
    expect(formatSearchTimeLabel('')).toBe('')
    expect(formatSearchTimeLabel('not-a-date')).toBe('')
  })

  it('一分钟内显示刚刚', () => {
    expect(formatSearchTimeLabel(new Date(Date.now() - 30_000).toISOString())).toBe(
      '刚刚',
    )
  })

  it('一小时内显示分钟前', () => {
    expect(formatSearchTimeLabel(new Date(Date.now() - 5 * 60_000).toISOString())).toBe(
      '5 分钟前',
    )
  })

  it('一天内显示小时前', () => {
    expect(formatSearchTimeLabel(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe(
      '3 小时前',
    )
  })

  it('一周内显示天前', () => {
    expect(formatSearchTimeLabel(new Date(Date.now() - 2 * 86400_000).toISOString())).toBe(
      '2 天前',
    )
  })

  it('超过一周显示月/日', () => {
    const t = new Date(Date.now() - 8 * 86400_000)
    expect(formatSearchTimeLabel(t.toISOString())).toBe(
      `${t.getMonth() + 1}/${t.getDate()}`,
    )
  })
})
