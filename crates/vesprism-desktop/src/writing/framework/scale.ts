/** 百万字怎么拆成可循环的章。字 = 汉字，不是英文 word。 */

export const NOVEL_SCALE = {
  targetChars: 1_000_000,
  chapterMin: 2000,
  chapterMax: 2500,
  chapterAim: 2200,
  volumeAim: 4,
  unitChapters: 8,
} as const

export function chapterCountFor(
  target: number = NOVEL_SCALE.targetChars,
  aim: number = NOVEL_SCALE.chapterAim,
): number {
  return Math.ceil(target / aim)
}

export function volumeChapterAim(
  target: number = NOVEL_SCALE.targetChars,
  volumes: number = NOVEL_SCALE.volumeAim,
  aim: number = NOVEL_SCALE.chapterAim,
): number {
  return Math.ceil(chapterCountFor(target, aim) / volumes)
}

export type ChapterWords = { min: number; max: number; aim: number }

/** 尺规「章目标字数」是人填的字符串，不是锁死 2200。 */
export function parseChapterWords(s: string | undefined): ChapterWords {
  const nums = [...String(s || '').matchAll(/(\d{3,6})/g)].map((m) => Number(m[1])).filter((n) => n > 0)
  if (nums.length >= 2) {
    const min = Math.min(nums[0], nums[1])
    const max = Math.max(nums[0], nums[1])
    return { min, max, aim: Math.round((min + max) / 2) }
  }
  if (nums.length === 1) {
    return { min: nums[0], max: nums[0], aim: nums[0] }
  }
  return { min: NOVEL_SCALE.chapterMin, max: NOVEL_SCALE.chapterMax, aim: NOVEL_SCALE.chapterAim }
}

export function countHanzi(text: string): number {
  let n = 0
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) n += 1
  }
  return n
}

export function acceptedChars(book: {
  drafts: { accepted: boolean; beats: { body: string }[] }[]
}): number {
  return book.drafts
    .filter((d) => d.accepted)
    .reduce((n, d) => n + d.beats.reduce((m, b) => m + countHanzi(b.body), 0), 0)
}

export function remainToTarget(
  book: { drafts: { accepted: boolean; beats: { body: string }[] }[] },
  target = NOVEL_SCALE.targetChars,
): number {
  return Math.max(0, target - acceptedChars(book))
}

export function volumeLandLine(book: {
  chapters: { id: string; no: number; unitId: string }[]
  units: { id: string; volumeId: string }[]
  volumes: { id: string; title: string }[]
  drafts: { chapterId: string; accepted: boolean }[]
}): string {
  const accepted = new Set(book.drafts.filter((d) => d.accepted).map((d) => d.chapterId))
  const last = [...book.chapters].filter((c) => accepted.has(c.id)).sort((a, b) => b.no - a.no)[0]
  if (!last) return ''
  const unit = book.units.find((u) => u.id === last.unitId)
  const vol = unit ? book.volumes.find((v) => v.id === unit.volumeId) : undefined
  const ch = `第${last.no}章`
  return vol?.title ? `${vol.title} · ${ch}` : ch
}

export function beatAimChars(chapterWords: string | undefined, beatCount: number): number {
  const aim = parseChapterWords(chapterWords).aim
  const n = Math.max(1, beatCount)
  return Math.max(1, Math.round(aim / n))
}

export type ContextBudget = {
  writerEats: string
  writerNever: string
  memory: string
}

/** 写手上下文预算：百万字靠案卷循环，不靠一次塞进模型。 */
export function contextBudget(): ContextBudget {
  return {
    writerEats: '尺规切片 + 出场当前态 + 到期伏笔 + 节拍 + 上章 80 字摘要和章末钩',
    writerNever: '总纲全文、已写各章正文、未出场人物档案、未到期伏笔的回收方案',
    memory: '案卷只在入卷采纳后改。未采纳不准开下一章。',
  }
}
