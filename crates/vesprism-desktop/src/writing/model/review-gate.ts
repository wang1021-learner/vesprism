/** 入卷硬门：代码卡破设定，不评文笔。模型 JSON 只当摘句来源。 */

import { countHanzi, parseChapterWords } from '../framework/scale'
import { complianceHits } from './compliance'
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

/** 黄金三章（1～3 章）专项硬门：签约率命门，比中段更严。 */
export function goldenThreeNotes(book: BookDemo, chapterId: string): string[] {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch || ch.no > 3) return []
  const notes: string[] = []
  if (!(ch.pleasure || '').trim()) notes.push('黄金三章：本章爽点兑现（pleasure）不能空。')
  if (!ch.endHookKind) notes.push('黄金三章：章末钩类型不能空。')
  return notes
}

/** 收尾段提示：最后几章（或最后一卷）必须有完本计划，否则只提示不挡入卷。 */
export function endingNotes(book: BookDemo, chapterId: string): string[] {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return []
  const maxNo = Math.max(0, ...book.chapters.map((c) => c.no))
  const nearEnd = ch.no >= maxNo - 2
  const lastVol = book.volumes.at(-1)
  const inFinalVolume = Boolean(
    lastVol && book.units.some((u) => u.volumeId === lastVol.id && u.id === ch.unitId),
  )
  if ((nearEnd || inFinalVolume) && !(book.outline.endingPlan || '').trim()) {
    return ['已到收尾段：总纲还没有完本计划（endingPlan），先补结局盘点再往下写。']
  }
  return []
}

/** 章号连续性：重号 / 缺号提醒（只提示，不自动重排，避免引入更隐蔽的错误）。 */
export function chapterNumberNotes(book: BookDemo): string[] {
  const nos = book.chapters.map((c) => c.no)
  if (nos.length === 0) return []
  const counts = new Map<number, number>()
  for (const n of nos) counts.set(n, (counts.get(n) ?? 0) + 1)
  const notes: string[] = []
  for (const [n, c] of counts) {
    if (c > 1) notes.push(`章号 ${n} 重复（${c} 章同号），请手动改。`)
  }
  const max = Math.max(...nos)
  for (let n = 1; n < max; n++) {
    if (!counts.has(n)) notes.push(`章号 ${n} 缺失（中间跳了号）。`)
  }
  return notes
}

/** 章纲偏差本地核对：章末钩是否真的落在正文末尾（只警告，不挡入卷）。 */
export function chapterDriftNotes(book: BookDemo, chapterId: string): string[] {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return []
  const notes: string[] = []
  const body = draftText(book, chapterId)
  if (!body.trim()) return notes

  const hook = (ch.endHook || '').trim()
  if (hook) {
    const frag = hook
      .replace(/[「」『』""'"？！。…]/g, '')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 4)
    const tail = body.slice(-160)
    const landed = frag.some((f) => tail.includes(f))
    if (!landed && frag.length > 0) {
      notes.push(`章纲偏差：章末钩「${hook}」没有落到正文末尾，可能被 AI 静默跳过。`)
    }
  }
  return notes
}

/** 伏笔孤儿：line 里提到的人名/地名已不在设定集（可能是改过名或删卡）。 */
export function foreshadowOrphans(book: BookDemo): string[] {
  const names = new Set<string>()
  for (const p of book.people) {
    names.add(p.name)
    names.add(p.id)
  }
  for (const pl of book.places) {
    names.add(pl.name)
    names.add(pl.id)
  }
  const STOP = new Set([
    '旧门', '拍场', '库房', '夜场', '钥匙', '残器', '图纸', '身份', '死局', '对赌', '影子',
    '第三', '眼睛', '瞳', '拍卖', '学徒', '鉴真', '母亲', '北宋', '官窑', '喷枪',
  ])
  const out: string[] = []
  for (const f of book.outline.foreshadows) {
    const tokens = (f.line.match(/[\u4e00-\u9fa5]{2,6}/g) ?? []).filter(
      (t) => !STOP.has(t) && t.length >= 2,
    )
    const unknown = [...new Set(tokens.filter((t) => !names.has(t)))]
    if (unknown.length > 0) {
      out.push(`伏笔 ${f.id} 提到「${unknown.join('、')}」，可能已不是设定集里的人/地。`)
    }
  }
  return out
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

  for (const hit of complianceHits(book, body, ch.platform)) {
    hints.push(`正文命中平台红线「${hit}」。`)
  }
  for (const g of goldenThreeNotes(book, chapterId)) {
    hints.push(g)
  }

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
