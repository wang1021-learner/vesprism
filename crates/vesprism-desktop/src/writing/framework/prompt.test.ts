import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from '../model/demo-yanpin'
import {
  assembleWriteChapter,
  assistantTextAfter,
  extractJson,
  fillCardUser,
  lastTaskUser,
  parseTaskRef,
  promptContainsForbiddenOutline,
  reviewerUser,
  rewriteUser,
  taskWire,
  washerSystem,
  washUser,
  writerSystem,
  writerUser,
} from './prompt'
import type { ChatMessage } from '../../types'

function userMsg(id: string, text: string): ChatMessage {
  return { id, role: 'user', text }
}
function asstMsg(id: string, text: string): ChatMessage {
  return { id, role: 'assistant', text }
}

describe('写手提示词', () => {
  it('第4章吃切片和上章摘要，不吃总纲因果', () => {
    const user = writerUser(YANPIN_EYE, 'ch-4')
    expect(user).toBeTruthy()
    if (!user) return
    expect(user).toContain('限知沈见真')
    expect(user).toContain('到期 F001')
    expect(user).toContain('节拍1 旧门')
    expect(user).toContain('上章摘要')
    expect(user).toContain('顾晚宁')
    expect(promptContainsForbiddenOutline(user, YANPIN_EYE)).toBe(false)
    expect(user.includes(YANPIN_EYE.outline.causality)).toBe(false)
  })

  it('第5章已锁，不组装写手词', () => {
    expect(writerUser(YANPIN_EYE, 'ch-5')).toBeNull()
    expect(assembleWriteChapter(YANPIN_EYE, 'ch-5')).toBeNull()
  })

  it('系统词禁止总纲和发明规则', () => {
    const sys = writerSystem()
    expect(sys).toMatch(/只吃用户给出的切片/)
    expect(sys).toMatch(/总纲全文/)
    expect(sys).toMatch(/发明新规则/)
    expect(sys).toMatch(/【/)
    expect(sys).toMatch(/禁止调用任何工具/)
    expect(sys).not.toMatch(/800～1200/)
  })

  it('写手用户词按尺规拆每块字数，不写死 800～1200', () => {
    const user = writerUser(YANPIN_EYE, 'ch-4')
    expect(user).toBeTruthy()
    expect(user).toContain('每块大约')
    expect(user).not.toMatch(/一块 800/)
  })

  it('写手用户词带上这一次的一句约束', () => {
    const user = writerUser(YANPIN_EYE, 'ch-4', '不要写系统弹窗')
    expect(user).toContain('不要写系统弹窗')
  })

  it('任务标记带书 id，解析时能对上本书', () => {
    const wire = taskWire('write-chapter', 'ch-4', 'sys', '写第四章', 'book-a')
    expect(parseTaskRef(wire)).toEqual({ kind: 'write-chapter', ref: 'ch-4', bookId: 'book-a' })
    const msgs: ChatMessage[] = [userMsg('u', wire), asstMsg('a', '【旧门】正文')]
    expect(lastTaskUser(msgs)?.bookId).toBe('book-a')
  })

  it('入卷词带正文，仍不带总纲全文', () => {
    const user = reviewerUser(YANPIN_EYE, 'ch-4')
    expect(user).toContain('看清了吗')
    expect(user).toContain('——正文——')
    expect(promptContainsForbiddenOutline(user ?? '', YANPIN_EYE)).toBe(false)
  })

  it('任务标记：lastTaskUser 取最后一条写台任务，assistant 正文可拼回', () => {
    const msgs: ChatMessage[] = [
      userMsg('u1', '随便聊聊'),
      asstMsg('a1', '好的。'),
      userMsg('u2', taskWire('write-chapter', 'ch-4', 'sys', '写第四章')),
      asstMsg('a2', '【切块 1】正文一。'),
      asstMsg('a3', '【切块 2】正文二。'),
    ]
    const found = lastTaskUser(msgs)
    expect(found?.kind).toBe('write-chapter')
    expect(found?.ref).toBe('ch-4')
    expect(parseTaskRef(msgs[2]?.text ?? '')?.ref).toBe('ch-4')
    expect(assistantTextAfter(msgs, found!.idx)).toBe('【切块 1】正文一。【切块 2】正文二。')
  })

  it('assistantTextAfter 在下一条 user 处停，不把后面的回复拼进本稿', () => {
    const msgs: ChatMessage[] = [
      userMsg('u1', taskWire('write-chapter', 'ch-1', 'sys', '写', 'book-a')),
      asstMsg('a1', '第一章正文'),
      userMsg('u2', taskWire('fill-card', 'pitch', 'sys', '补', 'book-a')),
      asstMsg('a2', '不该进稿纸'),
    ]
    expect(assistantTextAfter(msgs, 0)).toBe('第一章正文')
  })

  it('extractJson 剥围栏与杂讯', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(extractJson('结果是：{"b": [1, 2]} 完毕')).toEqual({ b: [1, 2] })
    expect(extractJson('不是 JSON')).toBeNull()
  })

  it('rewriteUser 只带这一块上下文', () => {
    const beat = YANPIN_EYE.beatsByChapter['ch-4']?.[0]
    expect(beat).toBeTruthy()
    if (!beat) return
    const u = rewriteUser(YANPIN_EYE, 'ch-4', beat)
    expect(u).toContain('切块')
    expect(u).not.toContain('总纲')
  })

  it('洗这块系统词钉死不改事实；用户词含旧正文和句式禁，不含总纲', () => {
    const beat = YANPIN_EYE.beatsByChapter['ch-4'][0]
    expect(beat).toBeTruthy()
    if (!beat) return
    const sys = washerSystem()
    expect(sys).toMatch(/只改腔调|只改表达/)
    expect(sys).toMatch(/不准改节拍任务|对白要点|落点/)
    expect(sys).toMatch(/禁止调用任何工具/)
    const u = washUser(YANPIN_EYE, 'ch-4', beat)
    expect(u).toContain('铁架上的编号贴纸')
    expect(u).toContain('句式禁')
    expect(u).toContain('喷枪走得太匀')
    expect(u).not.toContain(YANPIN_EYE.outline.causality)
    expect(u).toContain(beat.job)
  })

  it('写章纲提示词：番茄必须写出物理开场', () => {
    const ch = YANPIN_EYE.chapters.find((c) => c.id === 'ch-4')
    expect(ch).toBeTruthy()
    if (!ch) return
    const u = fillCardUser(YANPIN_EYE, 'chapter', { ...ch })
    expect(u).toMatch(/物理/)
  })
})
