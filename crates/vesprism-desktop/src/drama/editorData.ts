// 编辑器模拟数据；接真接口后由后端实体替换。
import { atom } from 'nanostores'
import type { JobErrorCode, JobStatus } from '../../../drama-core/bindings/drama'

export type Line = { id: string; speaker: string; text: string }
export type Shot = { id: string; order: number; lineIds: string[]; durationMs: number; dialogueMs: number; isStatic: boolean }
export type Look = { id: string; name: string; outfit: string; version: number; voice: string }

export const MAX_SHOT_MS = 15000

export const $lines = atom<Line[]>([])
export const $shots = atom<Shot[]>([])
export const $looks = atom<Look[]>([])
export const $scriptLocked = atom(false)
export const $checkSkipped = atom(false)

export function seedEditors(shotCount = 60): void {
  const lines: Line[] = Array.from({ length: shotCount }, (_, i) => ({ id: `L${i + 1}`, speaker: i % 2 ? '林夏' : '沈舟', text: `第 ${i + 1} 句台词` }))
  $lines.set(lines)
  $shots.set(lines.map((l, i) => ({ id: `shot-${i + 1}`, order: i, lineIds: [l.id], durationMs: 4000 + (i % 5) * 3000, dialogueMs: 3000 + (i % 7) * 1000, isStatic: i % 6 === 0 })))
  $looks.set([{ id: 'c1', name: '沈舟', outfit: '校服', version: 1, voice: '少年·清亮' }, { id: 'c2', name: '林夏', outfit: '风衣', version: 2, voice: '少女·温柔' }])
  $scriptLocked.set(false); $checkSkipped.set(false)
}

export type ShotFlag = 'too_long' | 'dialogue_overflow'
export function shotFlags(s: Shot): ShotFlag[] {
  const f: ShotFlag[] = []
  if (s.durationMs > MAX_SHOT_MS) f.push('too_long')
  if (s.dialogueMs > s.durationMs) f.push('dialogue_overflow')
  return f
}

/** 生成门禁：检查全过，或用户明确跳过（分镜一改，跳过记录作废）。 */
export function canGenerate(): boolean {
  return $checkSkipped.get() || $shots.get().every(s => shotFlags(s).length === 0)
}

export function moveShot(id: string, delta: number): void {
  const list = [...$shots.get()].sort((a, b) => a.order - b.order)
  const i = list.findIndex(s => s.id === id); const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  $shots.set(list.map((s, k) => ({ ...s, order: k })))
  $checkSkipped.set(false)
}

/** 任务卡片文案。结果不明不是新状态：failed + 错误码 unconfirmed_submit。 */
export function jobLabel(status: JobStatus, errorCode: JobErrorCode | null): string {
  if (status === 'failed' && errorCode === 'unconfirmed_submit') return '结果不明'
  return ({ queued: '排队中', running: '生成中', done: '已完成', failed: '失败', cancelled: '已取消', needs_login: '需重新登录' } as Record<string, string>)[status] ?? status
}
export const RETRY_UNCONFIRMED_TEXT = '上次提交结果不明，重试可能再扣一次费。确定重新提交吗？'
