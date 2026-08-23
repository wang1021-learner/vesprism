/**
 * 官方 `/loop`：最短 60 秒，7 天后过期。
 * 创建走会话斜杠（引擎展开成 scheduler_create）；列表来自本会话通知，没有 list ACP。
 */
import type { ScheduledTaskInfo } from '../store'

export const LOOP_MIN_SECS = 60
export const LOOP_EXPIRE_HINT = '7 天后自动过期'

export type IntervalUnit = 's' | 'm' | 'h' | 'd'

export type IntervalPreset = {
  token: string
  label: string
}

export const INTERVAL_PRESETS: IntervalPreset[] = [
  { token: '1m', label: '1 分钟' },
  { token: '5m', label: '5 分钟' },
  { token: '15m', label: '15 分钟' },
  { token: '30m', label: '30 分钟' },
  { token: '1h', label: '1 小时' },
  { token: '2h', label: '2 小时' },
  { token: '1d', label: '每天' },
]

export function isIntervalToken(s: string): boolean {
  if (s.length < 2) return false
  const digits = s.slice(0, -1)
  const suffix = s.slice(-1)
  if (!/^[smhd]$/.test(suffix)) return false
  if (!/^[1-9]\d*$/.test(digits)) return false
  const n = Number(digits)
  return Number.isFinite(n) && n > 0
}

export function intervalSecs(token: string): number | null {
  if (!isIntervalToken(token)) return null
  const n = Number(token.slice(0, -1))
  switch (token.slice(-1)) {
    case 's':
      return n
    case 'm':
      return n * 60
    case 'h':
      return n * 3600
    case 'd':
      return n * 86400
    default:
      return null
  }
}

export function makeIntervalToken(n: number, unit: IntervalUnit): string | null {
  const v = Math.floor(n)
  if (!Number.isFinite(v) || v <= 0) return null
  return `${v}${unit}`
}

/** 短于 60 秒会被引擎抬到 1 分钟。 */
export function intervalBelowMin(token: string): boolean {
  const secs = intervalSecs(token)
  return secs != null && secs < LOOP_MIN_SECS
}

export function humanScheduleZh(token: string): string {
  if (!isIntervalToken(token)) return '正在创建…'
  const n = Number(token.slice(0, -1))
  switch (token.slice(-1)) {
    case 's':
      return n === 1 ? '每秒' : `每 ${n} 秒`
    case 'm':
      return n === 1 ? '每分钟' : `每 ${n} 分钟`
    case 'h':
      return n === 1 ? '每小时' : `每 ${n} 小时`
    case 'd':
      return n === 1 ? '每天' : `每 ${n} 天`
    default:
      return `每 ${token}`
  }
}

/** 引擎英文 human_schedule → 中文。 */
export function zhHumanSchedule(raw: string): string {
  const s = raw.trim()
  if (!s || s === 'scheduling…' || s === 'scheduling...') return '正在创建…'
  const m = s.match(/^every\s+(\d+)\s+(second|seconds|minute|minutes|hour|hours|day|days)s?$/i)
  if (m) {
    const n = Number(m[1])
    const unit = m[2].toLowerCase()
    if (unit.startsWith('second')) return n === 1 ? '每秒' : `每 ${n} 秒`
    if (unit.startsWith('minute')) return n === 1 ? '每分钟' : `每 ${n} 分钟`
    if (unit.startsWith('hour')) return n === 1 ? '每小时' : `每 ${n} 小时`
    if (unit.startsWith('day')) return n === 1 ? '每天' : `每 ${n} 天`
  }
  if (/^every 1 second$/i.test(s)) return '每秒'
  if (/^every 1 minute$/i.test(s)) return '每分钟'
  if (/^every 1 hour$/i.test(s)) return '每小时'
  if (/^every 1 day$/i.test(s)) return '每天'
  return s
}

export function formatDurationZh(ms: number): string {
  if (ms <= 0) return '到期'
  const totalSec = Math.round(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
  if (m > 0) return s > 0 && m < 5 ? `${m} 分 ${s} 秒` : `${m} 分钟`
  return `${s} 秒`
}

export function nextFireLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return formatDurationZh(t - now)
}

export function lastFiredLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const ago = now - t
  if (ago < 0) return '刚刚'
  if (ago < 60_000) return '刚刚'
  return `${formatDurationZh(ago)}前`
}

export function buildLoopCommand(interval: string, prompt: string): string | null {
  const p = prompt.trim()
  const i = interval.trim()
  if (!p) return null
  if (i && isIntervalToken(i)) return `/loop ${i} ${p}`
  if (!i) return `/loop ${p}`
  return null
}

export function promptPreview(prompt: string, max = 72): string {
  const one = prompt.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, Math.max(0, max - 1))}…`
}

export type ScheduledTaskEvent = {
  op: string
  taskId: string
  prompt: string
  humanSchedule: string
  nextFireAt?: string | null
  reason?: string | null
}

export type ScheduledTaskApply = {
  list: ScheduledTaskInfo[]
  toast?: { text: string; kind: 'success' | 'info' | 'error' }
}

function upsert(
  prev: ScheduledTaskInfo[],
  next: ScheduledTaskInfo,
  dropPending: boolean,
): ScheduledTaskInfo[] {
  const base = dropPending ? prev.filter((t) => !t.pending) : prev
  const i = base.findIndex((t) => t.taskId === next.taskId)
  if (i < 0) return [...base, next]
  const cur = base[i]
  const merged: ScheduledTaskInfo = {
    ...cur,
    ...next,
    lastFiredAt: next.lastFiredAt ?? cur.lastFiredAt,
    fireCount: next.fireCount ?? cur.fireCount,
  }
  return base.map((t, idx) => (idx === i ? merged : t))
}

/** 把本会话 ScheduledTask 通知合成列表（官方 TUI 也是从通知重建，没有 list 接口）。 */
export function applyScheduledTask(
  prev: ScheduledTaskInfo[],
  ev: ScheduledTaskEvent,
  nowIso: string,
): ScheduledTaskApply {
  const id = ev.taskId.trim()
  if (!id) return { list: prev }
  if (ev.op === 'deleted') {
    const had = prev.some((t) => t.taskId === id)
    const list = prev.filter((t) => t.taskId !== id)
    const reason = (ev.reason || '').toLowerCase()
    if (had && reason === 'expired') {
      return { list, toast: { text: '定时已到期（7 天）', kind: 'info' } }
    }
    if (had && reason === 'completed') {
      return { list, toast: { text: '定时已跑完', kind: 'info' } }
    }
    return { list }
  }
  if (ev.op === 'fired') {
    const cur = prev.find((t) => t.taskId === id)
    if (!cur && !ev.nextFireAt) return { list: prev }
    const next: ScheduledTaskInfo = {
      taskId: id,
      prompt: ev.prompt || cur?.prompt || '',
      humanSchedule: ev.humanSchedule || cur?.humanSchedule || '',
      nextFireAt: ev.nextFireAt ?? null,
      lastFiredAt: nowIso,
      fireCount: (cur?.fireCount ?? 0) + 1,
      pending: false,
    }
    return {
      list: upsert(prev, next, false),
      toast: { text: `定时已跑一轮 · ${promptPreview(next.prompt, 36)}`, kind: 'info' },
    }
  }
  const cur = prev.find((t) => t.taskId === id && !t.pending)
  const next: ScheduledTaskInfo = {
    taskId: id,
    prompt: ev.prompt || cur?.prompt || '',
    humanSchedule: ev.humanSchedule || cur?.humanSchedule || '',
    nextFireAt: ev.nextFireAt ?? null,
    lastFiredAt: cur?.lastFiredAt,
    fireCount: cur?.fireCount,
    pending: false,
  }
  const isNew = !cur
  return {
    list: upsert(prev, next, true),
    toast: isNew
      ? {
          text: `已开始定时 · ${zhHumanSchedule(next.humanSchedule)}`,
          kind: 'success',
        }
      : undefined,
  }
}

export function makePendingTask(prompt: string, interval: string, now: number): ScheduledTaskInfo {
  return {
    taskId: `provisional-${now}`,
    prompt: prompt.trim(),
    humanSchedule: humanScheduleZh(interval),
    nextFireAt: null,
    pending: true,
    fireCount: 0,
  }
}
