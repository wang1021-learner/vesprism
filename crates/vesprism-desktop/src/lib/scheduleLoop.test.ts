import { describe, expect, it } from 'vitest'
import {
  applyScheduledTask,
  buildLoopCommand,
  formatDurationZh,
  humanScheduleZh,
  intervalBelowMin,
  isIntervalToken,
  makePendingTask,
  nextFireLabel,
  zhHumanSchedule,
} from './scheduleLoop'

describe('interval token', () => {
  it('只接受非零数字 + s/m/h/d', () => {
    expect(isIntervalToken('5m')).toBe(true)
    expect(isIntervalToken('1d')).toBe(true)
    expect(isIntervalToken('90s')).toBe(true)
    expect(isIntervalToken('0m')).toBe(false)
    expect(isIntervalToken('5')).toBe(false)
    expect(isIntervalToken('m5')).toBe(false)
  })

  it('短于 60 秒标下限', () => {
    expect(intervalBelowMin('30s')).toBe(true)
    expect(intervalBelowMin('1m')).toBe(false)
    expect(intervalBelowMin('1h')).toBe(false)
  })
})

describe('buildLoopCommand', () => {
  it('拼官方 /loop [interval] <prompt>', () => {
    expect(buildLoopCommand('5m', '检查部署')).toBe('/loop 5m 检查部署')
    expect(buildLoopCommand('', '检查部署')).toBe('/loop 检查部署')
    expect(buildLoopCommand('5m', '  ')).toBeNull()
    expect(buildLoopCommand('nope', 'x')).toBeNull()
  })
})

describe('human schedule', () => {
  it('token 中文', () => {
    expect(humanScheduleZh('1m')).toBe('每分钟')
    expect(humanScheduleZh('5m')).toBe('每 5 分钟')
    expect(humanScheduleZh('1d')).toBe('每天')
  })

  it('引擎英文转中文', () => {
    expect(zhHumanSchedule('every 5 minutes')).toBe('每 5 分钟')
    expect(zhHumanSchedule('every 1 hour')).toBe('每小时')
    expect(zhHumanSchedule('scheduling…')).toBe('正在创建…')
  })
})

describe('countdown', () => {
  it('到期与剩余', () => {
    expect(formatDurationZh(0)).toBe('到期')
    expect(formatDurationZh(45_000)).toBe('45 秒')
    expect(formatDurationZh(3 * 60_000)).toBe('3 分钟')
    expect(nextFireLabel('not-a-date')).toBe('')
    const soon = new Date(Date.now() + 90_000).toISOString()
    expect(nextFireLabel(soon)).toMatch(/1 分/)
  })
})

describe('applyScheduledTask', () => {
  it('创建替换 provisional，删除按 id', () => {
    const pending = makePendingTask('检查部署', '5m', 1)
    const created = applyScheduledTask(
      [pending],
      {
        op: 'created',
        taskId: 't1',
        prompt: '检查部署',
        humanSchedule: 'every 5 minutes',
        nextFireAt: '2030-01-01T00:00:00Z',
      },
      '2026-01-01T00:00:00Z',
    )
    expect(created.list).toHaveLength(1)
    expect(created.list[0].taskId).toBe('t1')
    expect(created.list[0].pending).toBe(false)
    expect(created.toast?.text).toContain('已开始定时')

    const gone = applyScheduledTask(
      created.list,
      { op: 'deleted', taskId: 't1', prompt: '', humanSchedule: '', reason: 'expired' },
      '2026-01-01T00:00:00Z',
    )
    expect(gone.list).toEqual([])
    expect(gone.toast?.text).toContain('到期')
  })

  it('触发累加次数；未知且无下次开火则忽略', () => {
    const base = applyScheduledTask(
      [],
      {
        op: 'created',
        taskId: 't1',
        prompt: 'ping',
        humanSchedule: 'every 1 minute',
        nextFireAt: '2030-01-01T00:00:00Z',
      },
      '2026-01-01T00:00:00Z',
    ).list
    const fired = applyScheduledTask(
      base,
      {
        op: 'fired',
        taskId: 't1',
        prompt: 'ping',
        humanSchedule: 'every 1 minute',
        nextFireAt: '2030-01-01T00:01:00Z',
      },
      '2026-01-01T00:00:30Z',
    )
    expect(fired.list[0].fireCount).toBe(1)
    expect(fired.list[0].lastFiredAt).toBe('2026-01-01T00:00:30Z')

    const skip = applyScheduledTask(
      [],
      { op: 'fired', taskId: 'ghost', prompt: 'x', humanSchedule: '' },
      '2026-01-01T00:00:00Z',
    )
    expect(skip.list).toEqual([])
  })
})
