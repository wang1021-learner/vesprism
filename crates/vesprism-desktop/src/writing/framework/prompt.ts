/** 写手 / 检查 / 拆卡的提示词。正文只吃切片。 */

import type { BeatCard, BookDemo, ChapterCard, DraftPage } from '../model/types'
import type { ChatMessage } from '../../types'
import type { WriteSlice } from '../model/slice'
import { writeSlice } from '../model/slice'
import { beatAimChars } from './scale'
import { effectiveSentenceBan } from '../model/sentence-ban'
import type { FillCardTarget } from '../model/apply'
import { nextChapterDebts } from '../model/create'
import { draftBodyForBeat, FILL_TARGET_LABEL } from '../model/apply'

// ── 任务标记：写台发给引擎的 user 消息前缀，回合归属 + 挂载恢复都靠它 ──

export const TASK_PREFIX = '【写完·'

export function taskLabel(kind: string): string {
  switch (kind) {
    case 'write-chapter':
      return '写这一章'
    case 'finish-chapter':
      return '写完这一章'
    case 'fill-review':
      return '检查这一章'
    case 'rewrite':
      return '重写一块'
    case 'wash':
      return '洗这块'
    case 'fill-card':
      return '补卡'
    default:
      return '写台指令'
  }
}

export function taskPrefixed(kind: string, user: string): string {
  return `${TASK_PREFIX}${taskLabel(kind)}】\n${user}`
}

/** 完整任务文本：人话前缀 + 机器可读标记（kind + ref）+ 系统词 + 任务词。 */
export function taskWire(
  kind: string,
  ref: string,
  system: string,
  user: string,
  bookId?: string,
): string {
  const book = bookId ? ` ${bookId}` : ''
  return `${TASK_PREFIX}${taskLabel(kind)}】\n【TASK ${kind} ${ref}${book}】\n${system}\n\n——任务——\n\n${user}`
}

/** 从消息文本解析机器标记。ref 为 chapterId / beatId / 补卡目标。 */
export function parseTaskRef(text: string): { kind: string; ref: string; bookId: string } | null {
  const m = /【TASK (\S+) ([^\s】]+)(?:\s+([^\s】]+))?】/.exec(text || '')
  return m ? { kind: m[1], ref: m[2], bookId: m[3] || '' } : null
}

/** 消息流里最后一条写台任务 user 消息（含 idx）。 */
export function lastTaskUser(
  msgs: ChatMessage[],
): { idx: number; kind: string; ref: string; bookId: string } | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'user') continue
    const t = parseTaskRef(m.text)
    if (t) return { idx: i, ...t }
  }
  return null
}

/** 某条 user 消息之后、下一条 user 之前的 assistant 正文（拼接）。 */
export function assistantTextAfter(msgs: ChatMessage[], idx: number): string {
  let out = ''
  for (let i = idx + 1; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role === 'user') break
    if (m.role === 'assistant' && m.text) out += m.text
  }
  return out.trim()
}

/** 从 AI 回复里剥出 JSON：优先 ```json 围栏，其次首尾花括号，最后整段。 */
export function extractJson(text: string): unknown | null {
  const t = (text || '').trim()
  if (!t) return null
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced ? fenced[1] : t).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      /* 落入整段尝试 */
    }
  }
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export function previousChapter(book: BookDemo, chapterId: string): ChapterCard | undefined {
  const ch = book.chapters.find((c) => c.id === chapterId)
  if (!ch) return undefined
  return book.chapters.find((c) => c.no === ch.no - 1)
}

export function washerSystem(): string {
  return [
    '你是写完的写手，这一轮只洗套话、只改表达。',
    '只改腔调。不准改节拍任务、对白要点、落点信息、谁知道什么。',
    '禁止调用任何工具：不要写文件、不要跑命令。只把洗过的正文打在回复里。',
    '不要标题，不要修改说明，不要总纲，不要解释你的写法。',
    '禁止发明新情节、新对白要点、新信息。',
  ].join('\n')
}

export function washUser(
  book: BookDemo,
  chapterId: string,
  beat: BeatCard,
  extra?: string,
): string | null {
  const slice = writeSlice(book, chapterId)
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!draft) return null
  const old = draftBodyForBeat(draft, beat.id, '')
  const lines: string[] = [
    '只洗这一块的套话。节拍任务、对白要点、落点信息、谁知道什么一律不准改。',
    `切块：${beat.title}`,
    `任务（冻结）：${beat.job || '—'}`,
    `对白要点（冻结）：${beat.dialogue || '—'}`,
    `信息（冻结）：${beat.info || '—'}`,
    `落点（冻结）：${beat.land || '—'}`,
    `句式禁：${effectiveSentenceBan(slice?.canon.sentenceBan ?? '')}`,
  ]
  const samples = (slice?.canon.samples ?? []).filter((s) => s.trim()).slice(0, 3)
  if (samples.length > 0) {
    lines.push('文风样本（只模仿写法，不当故事材料）：')
    samples.forEach((s, i) => lines.push(`样本${i + 1}：「${s}」`))
  }
  for (const p of slice?.people ?? []) {
    if (p.voiceSample.trim()) lines.push(`出场 ${p.name} 样本：「${p.voiceSample}」`)
  }
  lines.push('——旧正文——')
  lines.push(old)
  if (extra && extra.trim()) lines.push(`额外要求：${extra.trim()}`)
  lines.push('只输出洗过的这一块正文。不要标题，不要修改说明。')
  return lines.join('\n')
}

export function reviewerJsonHint(): string {
  return '只输出 JSON 检查单，字段：openHookOk/goalOk/endHookOk/voiceLeak/forbiddenKnow/cheatAbuse/dueSeen/unnumbered（字符串，unnumbered 无则写「无」），states（["id：当前态或剩余配额或谁能进"]，优先 id，其次名字），foreshadow（["F001：状态说明"]），summary80（80 字摘要）。不要解释。'
}

export function writerSystem(): string {
  return [
    '你是写完的写手。只写本章正文。',
    '你只吃用户给出的切片：尺规切片、出场人物当前态、到期伏笔、节拍、上章摘要。',
    '禁止调用任何工具：不要写文件、不要跑命令。只把正文打在回复里。',
    '禁止：总纲全文、未出场人物档案、发明新规则、让人说出不能知道的、系统弹窗、章末总结句、解释你的写法。',
    '按节拍一块一块写。每块字数看用户切片里的章目标和每块大约字数，不要按固定块长写。',
    '输出格式：每一块必须以【节拍标题】起头，标题与切片里的节拍标题一字不差。不要标题党，不要写作说明。',
  ].join('\n')
}

export function reviewerSystem(): string {
  return [
    '你是写完的检查。对照章纲和设定集填入卷卡，不是看写得美不美。',
    '必须逐项回答：开场钩、目标、章末钩、口吻泄露、不能知道的、金手指白用、到期伏笔、未编号新埋。',
    '给出每个人物当前态（一句话）和伏笔状态变化。80 字章摘要。',
    '禁止调用任何工具：不要写文件。只输出 JSON 检查单。',
    '禁止改设定集。未标明「建议采纳」则视为未通过。',
  ].join('\n')
}

export function splitterSystem(target: string): string {
  return [
    `你是写完的拆卡。把上一层填空卡拆成「${target}」填空卡。`,
    '禁止调用任何工具：不要写文件。只输出补全后的 JSON。',
    '只填字段。不写场面，不写对白，不发明金手指。',
    '缺门槛字段就停，不要用散文补。',
  ].join('\n')
}

// ── 补卡（fill-* / split-*）：目标卡 JSON + 指令，AI 返回补全后的 JSON ──

export function fillCardUser(
  book: BookDemo,
  target: FillCardTarget,
  card: Record<string, unknown>,
  extra?: string,
): string {
  const label = FILL_TARGET_LABEL[target]
  const lines: string[] = [
    `目标卡：${label}。`,
    `当前书：${book.title}（一句话卖点：${book.pitch.logline || '未定'}）`,
    `已有内容：${JSON.stringify(card, null, 2)}`,
    '补齐空缺字段；不要编造与已有内容冲突的事实。',
  ]
  if (target === 'volume' && book.outline.causality) {
    lines.push(`长线因果（拆卷用，不要写进正文）：${book.outline.causality}`)
  }
  if (target === 'unit') {
    const vol = book.volumes.at(-1)
    if (vol) lines.push(`本卷问题：${vol.question}；必须兑现：${vol.mustPay.join('、')}`)
  }
  if (target === 'chapter') {
    const unit = book.units.find((u) => u.id === String(card.unitId ?? '')) || book.units.at(-1)
    if (unit) lines.push(`本单元胜负：${unit.win}；单元末钩：${unit.endHook}`)
    const platform = String(card.platform ?? '')
    const tomato =
      platform === 'tomato' || /番茄/.test(platform) || /番茄/.test(book.pitch.platform)
    if (tomato) {
      lines.push(
        '平台番茄：openHook 必须是开场 300 字内落地的物理事件（有人、有动作、有现场），禁止心理独白或氛围空镜当钩。',
      )
    }
    const debts = nextChapterDebts(book, String(card.id ?? ''))
    if (debts) lines.push(debts)
  }
  if (target === 'beats') {
    const cid = String(card.chapterId ?? '')
    const ch = book.chapters.find((c) => c.id === cid)
    if (ch) lines.push(`章目标：${ch.goal}；章末钩：${ch.endHook}（${ch.endHookKind}）`)
  }
  if (extra && extra.trim()) lines.push(`额外要求：${extra.trim()}`)
  lines.push('只输出补全后的完整 JSON，不要任何解释，不要 Markdown 围栏。')
  return lines.join('\n')
}

// ── 重写一块：只发该切块上下文 ──

export function rewriteUser(
  book: BookDemo,
  chapterId: string,
  beat: BeatCard,
  extra?: string,
): string {
  const slice = writeSlice(book, chapterId)
  const prev = previousChapter(book, chapterId)
  const prevReview = prev ? book.reviews.find((r) => r.chapterId === prev.id) : undefined
  const lines: string[] = [
    `只重写这一个切块，其余正文一律不动：`,
    `切块：${beat.title}`,
    `场面：${beat.scene || '—'}`,
    `任务：${beat.job || '—'}`,
    `对白要点：${beat.dialogue || '—'}`,
    `信息：${beat.info || '—'}`,
    `情绪：${beat.mood || '—'}`,
    `落点：${beat.land || '—'}`,
  ]
  if (slice) {
    lines.push(`本章：第${slice.no}章 ${slice.title || '未拟题'}（视角：${slice.canon.pov}）`)
    lines.push(`力量上限：${slice.canon.powerCap || '—'}`)
    lines.push(`叙事禁：${slice.canon.narrativeBan || '—'}`)
    lines.push(`句式禁：${effectiveSentenceBan(slice.canon.sentenceBan)}`)
    for (const p of slice.people) {
      if (p.voiceSample.trim()) lines.push(`出场 ${p.name} 样本：「${p.voiceSample}」`)
    }
  } else {
    lines.push(`句式禁：${effectiveSentenceBan('')}`)
  }
  if (prevReview?.summary80) lines.push(`上章摘要：${prevReview.summary80}`)
  if (extra && extra.trim()) lines.push(`额外要求：${extra.trim()}`)
  lines.push('输出这一块的正文。不要标题，不要解释你的写法。')
  return lines.join('\n')
}

function sliceLines(slice: WriteSlice, book: BookDemo): string[] {
  const prev = previousChapter(book, slice.chapterId)
  const prevReview = prev ? book.reviews.find((r) => r.chapterId === prev.id) : undefined
  const lines: string[] = [
    `本章：第${slice.no}章 ${slice.title || '未拟题'}`,
    `视角：${slice.canon.pov}`,
    `章目标字数：${slice.canon.chapterWords}`,
    `每块大约 ${beatAimChars(slice.canon.chapterWords, slice.beats.length || 3)} 字`,
    `力量上限：${slice.canon.powerCap}`,
    `叙事禁：${slice.canon.narrativeBan}`,
    `句式禁：${effectiveSentenceBan(slice.canon.sentenceBan)}`,
    `一章算写完：${slice.canon.doneWhen}`,
  ]
  const samples = slice.canon.samples.filter((s) => s.trim()).slice(0, 3)
  if (samples.length > 0) {
    lines.push('文风样本（只模仿写法，不当故事材料）：')
    samples.forEach((s, i) => lines.push(`样本${i + 1}：「${s}」`))
  }
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
  for (const f of slice.watch) lines.push(`旁观 ${f.id}：${f.line}（${f.thisVolume}）`)
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

export function writerUser(book: BookDemo, chapterId: string, extra?: string): string | null {
  const slice = writeSlice(book, chapterId)
  if (!slice) return null
  if (slice.locked) return null
  const lines = sliceLines(slice, book)
  if (extra && extra.trim()) lines.push(`额外要求：${extra.trim()}`)
  lines.push('每块用【节拍标题】起头，标题必须和上面的节拍标题一致。')
  return lines.join('\n')
}

export function reviewerUser(book: BookDemo, chapterId: string, extra?: string): string | null {
  const slice = writeSlice(book, chapterId)
  const ch = book.chapters.find((c) => c.id === chapterId)
  const draft = book.drafts.find((d) => d.chapterId === chapterId)
  if (!slice || !ch || !draft) return null
  const body = draftBody(draft, slice)
  const lines = [
    `章纲目标：${ch.goal}`,
    `开场钩：${ch.openHook}`,
    `章末钩：${ch.endHook}`,
    `信息禁止：${ch.infoForbid}`,
    ...sliceLines(slice, book),
    '——正文——',
    body,
  ]
  if (extra && extra.trim()) lines.push(`额外要求：${extra.trim()}`)
  return lines.join('\n')
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

export function assembleWriteChapter(
  book: BookDemo,
  chapterId: string,
  extra?: string,
): AssembledPrompt | null {
  const user = writerUser(book, chapterId, extra)
  if (!user) return null
  return { role: 'writer', system: writerSystem(), user }
}
