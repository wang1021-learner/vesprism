/** 写手 / 检查 / 拆卡的提示词。正文只吃切片。 */

import type { BookDemo, ChapterCard, DraftPage } from '../model/types'
import type { WriteSlice } from '../model/slice'
import { writeSlice } from '../model/slice'

export function previousChapter(book: BookDemo, chapterId: string): ChapterCard | undefined {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return undefined
  return book.chapters.find((c) => c.no === ch.no - 1)
}

export function writerSystem(): string {
  return [
    '你是写完的写手。只写本章正文。',
    '你只吃用户给出的切片：尺规切片、出场人物当前态、到期伏笔、节拍、上章摘要。',
    '禁止：总纲全文、未出场人物档案、发明新规则、让人说出不能知道的、系统弹窗、章末总结句、解释你的写法。',
    '按节拍一块一块写。一块 800～1200 字。章目标字数以切片为准。',
    '输出：按节拍分块的正文，不要标题党，不要写作说明。',
  ].join('\n')
}

export function reviewerSystem(): string {
  return [
    '你是写完的检查。对照章纲和设定集填入卷卡，不是看写得美不美。',
    '必须逐项回答：开场钩、目标、章末钩、口吻泄露、不能知道的、金手指白用、到期伏笔、未编号新埋。',
    '给出每个人物当前态（一句话）和伏笔状态变化。80 字章摘要。',
    '禁止改设定集。未标明「建议采纳」则视为未通过。',
  ].join('\n')
}

export function splitterSystem(target: string): string {
  return [
    `你是写完的拆卡。把上一层填空卡拆成「${target}」填空卡。`,
    '只填字段。不写场面，不写对白，不发明金手指。',
    '缺门槛字段就停，不要用散文补。',
  ].join('\n')
}

function sliceLines(slice: WriteSlice, book: BookDemo): string[] {
  const prev = previousChapter(book, slice.chapterId)
  const prevReview = prev ? book.reviews.find((r) => r.chapterId === prev.id) : undefined
  const lines: string[] = [
    `本章：第${slice.no}章 ${slice.title || '未拟题'}`,
    `视角：${slice.canon.pov}`,
    `章目标字数：${slice.canon.chapterWords}`,
    `力量上限：${slice.canon.powerCap}`,
    `叙事禁：${slice.canon.narrativeBan}`,
    `句式禁：${slice.canon.sentenceBan}`,
    `一章算写完：${slice.canon.doneWhen}`,
  ]
  if (prev) {
    lines.push(`上章第${prev.no}章末钩：${prev.endHook}`)
    if (prevReview?.summary80) lines.push(`上章摘要：${prevReview.summary80}`)
  }
  for (const p of slice.people) {
    lines.push(`出场 ${p.name} 当前态：${p.state}`)
    lines.push(`出场 ${p.name} 不能知道：${p.mustNotKnow}`)
    lines.push(`出场 ${p.name} 样本：「${p.voiceSample}」`)
  }
  for (const p of slice.places) lines.push(`地点 ${p.name}：${p.job}`)
  for (const r of slice.rules) {
    lines.push(`规则 ${r.name} 配额：${r.quota}`)
    lines.push(`规则 ${r.name} 不能：${r.cannot}`)
  }
  if (slice.due.length === 0) lines.push('到期伏笔：无')
  else {
    for (const f of slice.due) lines.push(`到期 ${f.id}：${f.line}（${f.thisVolume}）`)
  }
  for (const [i, b] of slice.beats.entries()) {
    lines.push(`节拍${i + 1} ${b.title} 场面：${b.scene}`)
    lines.push(`节拍${i + 1} 任务：${b.job}`)
    lines.push(`节拍${i + 1} 对白：${b.dialogue}`)
    lines.push(`节拍${i + 1} 信息：${b.info}`)
    lines.push(`节拍${i + 1} 情绪：${b.mood}`)
    lines.push(`节拍${i + 1} 落点：${b.land}`)
  }
  return lines
}

export function writerUser(book: BookDemo, chapterId: string): string | null {
  const slice = writeSlice(book, chapterId)
  if (!slice) return null
  if (slice.locked) return null
  return sliceLines(slice, book).join('\n')
}

export function reviewerUser(book: BookDemo, chapterId: string): string | null {
  const slice = writeSlice(book, chapterId)
  const ch = book.chapters.find((c) => c.id === chapterId)
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!slice || !ch || !draft) return null
  const body = draftBody(draft, slice)
  return [
    `章纲目标：${ch.goal}`,
    `开场钩：${ch.openHook}`,
    `章末钩：${ch.endHook}`,
    `信息禁止：${ch.infoForbid}`,
    ...sliceLines(slice, book),
    '——正文——',
    body,
  ].join('\n')
}

function draftBody(draft: DraftPage, slice: WriteSlice): string {
  return draft.beats
    .map((block) => {
      const meta = slice.beats.find((b) => b.id === block.beatId)
      return `【${meta?.title ?? block.beatId}】\n${block.body}`
    })
    .join('\n\n')
}

export function promptContainsForbiddenOutline(text: string, book: BookDemo): boolean {
  return (
    text.includes(book.outline.causality) ||
    text.includes(book.outline.act1) ||
    text.includes(book.outline.act2) ||
    text.includes(book.outline.act3)
  )
}

export type AssembledPrompt = {
  role: 'writer' | 'reviewer' | 'splitter'
  system: string
  user: string
}

export function assembleWriteChapter(book: BookDemo, chapterId: string): AssembledPrompt | null {
  const user = writerUser(book, chapterId)
  if (!user) return null
  return { role: 'writer', system: writerSystem(), user }
}
