/** 入卷硬门：代码卡破设定，不评文笔。模型 JSON 只当摘句来源。 */

import { countHanzi, parseChapterWords } from '../framework/scale'
import { DEFAULT_SENTENCE_BAN, effectiveSentenceBan } from './sentence-ban'
import type { BookDemo, ChapterCard } from './types'

export function chapterIsTomato(book: BookDemo, ch: ChapterCard): boolean {
  if (ch.platform === 'qidian') return false
  if (ch.platform === 'tomato') return true
  return /番茄/.test(book.pitch.platform)
}

export function unnumberedIsEmpty(s: string): boolean {
  const t = (s || '').trim()
  if (!t) return true
  return /^(无|没有|无新埋|无未编号)[。.]?$/.test(t)
}

export function banTokens(s: string): string[] {
  const parts = (s || '')
    .split(/[；;。\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
  const extra: string[] = []
  for (const p of parts) {
    for (const q of p.matchAll(/「([^」]+)」/g)) {
      for (const bit of q[1].split('/')) {
        const t = bit.trim()
        if (t.length >= 2) extra.push(t)
      }
    }
  }
  return [...parts, ...extra]
}

export function textHitsBan(text: string, ban: string): boolean {
  if (!ban.trim() || !text) return false
  return banTokens(ban).some((tok) => text.includes(tok))
}

export function draftText(book: BookDemo, chapterId: string): string {
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!draft) return ''
  return draft.beats.map((b) => b.body).join('\n')
}

export function wordCountNotes(book: BookDemo, chapterId: string): string[] {
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!draft) return []
  const n = countHanzi(draftText(book, chapterId))
  const { min, max, aim } = parseChapterWords(book.canon.chapterWords)
  if (n < min) return [`已写 ${n} 字，不够目标 ${min}～${max}（约 ${aim}）。`]
  if (n > max) return [`已写 ${n} 字，超过目标 ${min}～${max}（约 ${aim}）。`]
  return []
}

const OPEN_HOOK_NEG = /未落地|没有落地|未在前\s*300|前\s*300\s*字没有|开场钩空/

export function reviewBlocksAdopt(
  book: BookDemo,
  chapterId: string,
): { ok: boolean; hints: string[] } {
  const ch = book.chapters.find((c) => c.id === chapterId)
  const review = book.reviews.find((r) => r.chapterId === chapterId)
  const hints: string[] = []
  if (!ch || !review) return { ok: false, hints: ['先检查，再入卷。'] }

  const body = draftText(book, chapterId)

  if (textHitsBan(body, book.canon.powerCap)) {
    hints.push('正文命中力量上限。')
  }
  for (const r of book.rules.filter((x) => ch.cast.includes(x.id))) {
    if (textHitsBan(body, r.cannot)) hints.push(`正文命中规则「${r.name}」不能做的。`)
  }
  for (const p of book.people.filter((x) => ch.cast.includes(x.id))) {
    if (textHitsBan(body, p.mustNotKnow)) hints.push(`${p.name} 说出了不能知道的。`)
  }

  if (!unnumberedIsEmpty(review.unnumbered)) {
    const lines = review.unnumbered
      .split(/[\n；;]/)
      .map((s) => s.trim())
      .filter((s) => s && !unnumberedIsEmpty(s))
    const missing = lines.filter(
      (line) => !book.outline.foreshadows.some((f) => f.line.includes(line) || line.includes(f.line)),
    )
    if (missing.length > 0) hints.push('有未编号新埋，先编号进伏笔表。')
  }

  if (chapterIsTomato(book, ch)) {
    if (!(ch.openHook || '').trim()) {
      hints.push('番茄章开场钩必须是物理事件，不能空着。')
    } else if (OPEN_HOOK_NEG.test(review.openHookOk)) {
      hints.push('番茄开场钩未在前 300 字落地。')
    }
  }

  if (!(review.summary80 || '').trim()) {
    hints.push('入卷需要 80 字摘要。')
  }

  return { ok: hints.length === 0, hints }
}

function acceptedBody(book: BookDemo, chapterId: string): string {
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!draft?.accepted) return ''
  return draftText(book, chapterId).trim()
}

function headingOf(ch: { no: number; title: string }): string {
  return `第${ch.no}章${ch.title ? ` ${ch.title}` : ''}`
}

export function exportChapterPlain(book: BookDemo, chapterId: string): string {
  const ch = book.chapters.find((c) => c.id === chapterId)
  const body = acceptedBody(book, chapterId)
  if (!body || !ch) return ''
  return `${headingOf(ch)}\n\n${body}\n`
}

function joinChapters(book: BookDemo, chapters: ChapterCard[]): string {
  const parts = [book.title || '未命名']
  const sorted = [...chapters].sort((a, b) => a.no - b.no)
  for (const ch of sorted) {
    const body = acceptedBody(book, ch.id)
    if (!body) continue
    parts.push(`${headingOf(ch)}\n\n${body}`)
  }
  if (parts.length < 2) return ''
  return `${parts.join('\n\n')}\n`
}

export function exportBookPlain(book: BookDemo): string {
  return joinChapters(book, book.chapters)
}

export function exportVolumePlain(book: BookDemo, volumeId: string): string {
  const unitIds = new Set(book.units.filter((u) => u.volumeId === volumeId).map((u) => u.id))
  return joinChapters(
    book,
    book.chapters.filter((c) => unitIds.has(c.unitId)),
  )
}

/** 句式套话命中，只提示去洗，不挡入卷。 */
export function styleHits(book: BookDemo, chapterId: string): string[] {
  const body = draftText(book, chapterId)
  const merged = `${effectiveSentenceBan(book.canon.sentenceBan)}；${DEFAULT_SENTENCE_BAN}`
  return [...new Set(banTokens(merged))].filter((tok) => body.includes(tok))
}
