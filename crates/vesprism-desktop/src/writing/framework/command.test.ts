import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from '../model/demo-yanpin'
import { parseDeskCommand } from './command'
import { defaultVerb, verbsForStation } from './station'

const verbs = verbsForStation(YANPIN_EYE, 'ch-4')
const fallback = defaultVerb(YANPIN_EYE, 'ch-4')

describe('写台命令条', () => {
  it('斜杠点名工位，后面当这一句人话', () => {
    const c = parseDeskCommand('/写本章 冷一点，别解释瞳术', verbs, fallback)
    expect(c.verb.id).toBe('write-chapter')
    expect(c.extra).toBe('冷一点，别解释瞳术')
  })

  it('/重写节拍2 落到选区', () => {
    const c = parseDeskCommand('/重写节拍2 只留那一句', verbs, fallback)
    expect(c.verb.id).toBe('rewrite-span')
    expect(c.beatNo).toBe(2)
    expect(c.extra).toBe('只留那一句')
  })

  it('/问 只读', () => {
    const c = parseDeskCommand('/问 顾晚宁现在能知道什么', verbs, fallback)
    expect(c.verb.id).toBe('ask')
    expect(c.verb.kind).toBe('read')
    expect(c.extra).toBe('顾晚宁现在能知道什么')
  })

  it('没有斜杠时整句当约束，工位用当前层默认', () => {
    const c = parseDeskCommand('章末钩落在问句上', verbs, fallback)
    expect(c.verb.id).toBe(fallback.id)
    expect(c.extra).toBe('章末钩落在问句上')
  })

  it('当前层没有的工位不能靠闲聊调出来', () => {
    const c = parseDeskCommand('/写宪法 顺便改人设', verbs, fallback)
    expect(c.verb.id).toBe('write-canon')
    expect(c.verb.ok).toBe(false)
    expect(c.verb.hint).toMatch(/当前这一步没有这个动作/)
  })
})
