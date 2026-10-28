import { beforeEach, describe, expect, it } from 'vitest'
import { $checkSkipped, $shots, canGenerate, jobLabel, moveShot, seedEditors, shotFlags } from './editorData'

beforeEach(() => seedEditors(60))

describe('drama editors', () => {
  it('超 15 秒和台词溢出被标出', () => {
    expect(shotFlags({ id: 'x', order: 0, lineIds: [], durationMs: 16000, dialogueMs: 17000, isStatic: false })).toEqual(['too_long', 'dialogue_overflow'])
  })
  it('有未过检查的镜头时不能生成，跳过后可以，改分镜后跳过作废', () => {
    expect($shots.get().some(s => shotFlags(s).length)).toBe(true)
    expect(canGenerate()).toBe(false)
    $checkSkipped.set(true); expect(canGenerate()).toBe(true)
    moveShot('shot-2', -1); expect($checkSkipped.get()).toBe(false); expect(canGenerate()).toBe(false)
  })
  it('拖序只换顺序', () => {
    moveShot('shot-2', -1)
    const ordered = [...$shots.get()].sort((a, b) => a.order - b.order).map(s => s.id)
    expect(ordered.slice(0, 2)).toEqual(['shot-2', 'shot-1'])
  })
  it('结果不明按错误码判断', () => {
    expect(jobLabel('failed', 'unconfirmed_submit')).toBe('结果不明')
    expect(jobLabel('failed', 'provider_failed')).toBe('失败')
    expect(jobLabel('needs_login', null)).toBe('需重新登录')
  })
})
